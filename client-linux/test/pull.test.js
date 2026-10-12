import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519KeyPair } from '../../core/index.js';
import { ApiClient } from '../lib/api.js';
import { validateConfig } from '../lib/config.js';
import { buildVersion, representationFor } from '../lib/documents.js';
import { listDocuments } from '../lib/list.js';
import { pathsIn } from '../lib/paths.js';
import { pullFile } from '../lib/pull.js';
import { pushFile } from '../lib/push.js';
import { getEntry, loadState } from '../lib/state.js';
import { startFakeCustodian } from '../testlib/fake-custodian.js';

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const { privateKeyPem } = generateEd25519KeyPair();
const T0 = new Date('2026-10-10T13:00:00Z');
const T1 = new Date('2026-10-10T13:05:00Z');
const T2 = new Date('2026-10-10T13:10:00Z');

async function withEnv(fn) {
  const fake = await startFakeCustodian();
  const root = mkdtempSync(join(tmpdir(), 'openrwp-pull-'));
  const paths = pathsIn(join(root, 'home'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir);
  const config = validateConfig({ baseUrl: fake.baseUrl, namespace: NS, deviceLabel: 'Test', docsDir });
  const api = new ApiClient({ baseUrl: fake.baseUrl, privateKeyPem });
  const file = (name) => join(docsDir, name);
  const env = {
    fake, file,
    write: (name, text) => writeFileSync(file(name), text),
    read: (name) => readFileSync(file(name), 'utf8'),
    push: (fileName, now = T0) => pushFile({ config, paths, api, fileName, now: () => now }),
    pull: (fileName, options = {}) => pullFile({ config, paths, api, fileName, ...options }),
    entry: (name) => getEntry(loadState(paths.state), name),
    rows: () => listDocuments({ config, paths }),
  };
  try {
    await fn(env);
  } finally {
    await fake.close();
  }
}

const foreign = (parent, text, now = T1) => buildVersion({
  representation: representationFor('a.md', Buffer.from(text)), parents: [parent], now,
});
const versionGets = (fake) => fake.log.filter((l) => l.startsWith('GET') && l.includes('/versions/')).length;

test('a deleted file is written again from its head', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    const first = await env.push('a.md');
    unlinkSync(env.file('a.md'));
    assert.equal(env.rows()[0].status, 'missing');
    const r = await env.pull('a.md');
    assert.equal(r.status, 'created');
    assert.equal(r.versionHash, first.versionHash);
    assert.equal(env.read('a.md'), 'sample text');
    assert.equal(env.rows()[0].status, 'in-sync');
  });
});

test('nothing to do when the file is at the head', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    await env.push('a.md');
    assert.equal((await env.pull('a.md')).status, 'up-to-date');
    assert.equal(versionGets(env.fake), 0);
  });
});

test('a newer version of another device is pulled, then push builds on it', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    const first = await env.push('a.md');
    const other = foreign(first.versionHash, 'other device');
    env.fake.seed(NS, first.recordId, other);

    const r = await env.pull('a.md');
    assert.equal(r.status, 'updated');
    assert.equal(env.read('a.md'), 'other device');
    assert.deepEqual(env.entry('a.md'), {
      recordId: first.recordId,
      head: other.versionHash,
      contentHash: representationFor('a.md', Buffer.from('other device')).contentHash,
    });

    env.write('a.md', 'next');
    const next = await env.push('a.md', T2);
    assert.equal(next.status, 'created');
    assert.deepEqual(next.parents, [other.versionHash]);
  });
});

test('local changes block the pull; --force overwrites and keeps the file mode', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    await env.push('a.md');
    env.write('a.md', 'edited');
    chmodSync(env.file('a.md'), 0o600);
    await assert.rejects(env.pull('a.md'), { code: 'local-changes' });
    assert.equal(env.read('a.md'), 'edited');

    const r = await env.pull('a.md', { force: true });
    assert.equal(r.status, 'updated');
    assert.equal(env.read('a.md'), 'sample text');
    assert.equal(statSync(env.file('a.md')).mode & 0o777, 0o600);
  });
});

test('several heads: pull asks for --version; the entry stays as it was', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    const first = await env.push('a.md');
    const one = foreign(first.versionHash, 'branch one');
    env.fake.seed(NS, first.recordId, one);
    env.fake.seed(NS, first.recordId, foreign(first.versionHash, 'branch two', T2));

    await assert.rejects(env.pull('a.md'), { code: 'multiple-heads' });
    const r = await env.pull('a.md', { version: one.versionHash.slice(0, 8) });
    assert.equal(r.status, 'restored');
    assert.equal(env.read('a.md'), 'branch one');
    assert.equal(env.entry('a.md').head, first.versionHash);
  });
});

test('an older version can be restored; push then adds a version on the head', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'one');
    const v1 = await env.push('a.md', T0);
    env.write('a.md', 'two');
    const v2 = await env.push('a.md', T1);

    const r = await env.pull('a.md', { version: v1.versionHash.slice(0, 8) });
    assert.equal(r.status, 'restored');
    assert.equal(env.read('a.md'), 'one');
    assert.equal(env.entry('a.md').head, v2.versionHash);
    assert.equal(env.rows()[0].status, 'modified');

    const v3 = await env.push('a.md', T2);
    assert.equal(v3.status, 'created');
    assert.deepEqual(v3.parents, [v2.versionHash]);
    assert.equal(env.rows()[0].status, 'in-sync');
  });
});

test('data that does not match its hashes is never written', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    const first = await env.push('a.md');
    unlinkSync(env.file('a.md'));
    const stored = env.fake.records.get(`${NS}/${first.recordId}`).get(first.versionHash);
    stored.representations[0].content = Buffer.from('tampered').toString('base64');
    await assert.rejects(env.pull('a.md'), { code: 'invalid-server-data' });
    assert.equal(existsSync(env.file('a.md')), false);
  });
});

test('--version needs a usable and existing prefix', async () => {
  await withEnv(async (env) => {
    env.write('a.md', 'sample text');
    await env.push('a.md');
    await assert.rejects(env.pull('a.md', { version: 'abc' }), { code: 'invalid-argument' });
    await assert.rejects(env.pull('a.md', { version: 'ffffffff' }), { code: 'version-not-found' });
  });
});

test('a file that was never pushed cannot be pulled', async () => {
  await withEnv(async (env) => {
    await assert.rejects(env.pull('other.md'), { code: 'not-tracked' });
    assert.equal(env.fake.log.length, 0);
  });
});
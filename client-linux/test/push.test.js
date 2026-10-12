import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519KeyPair } from '../../core/index.js';
import { ApiClient } from '../lib/api.js';
import { validateConfig } from '../lib/config.js';
import { buildVersion, representationFor } from '../lib/documents.js';
import { renderGraph } from '../lib/graph-ascii.js';
import { loadHistory } from '../lib/history.js';
import { pathsIn } from '../lib/paths.js';
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
  const root = mkdtempSync(join(tmpdir(), 'openrwp-push-'));
  const paths = pathsIn(join(root, 'home'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir);
  const config = validateConfig({ baseUrl: fake.baseUrl, namespace: NS, deviceLabel: 'Test', docsDir });
  const api = new ApiClient({ baseUrl: fake.baseUrl, privateKeyPem });
  const env = {
    fake, paths, config, api,
    write: (name, text) => writeFileSync(join(docsDir, name), text),
    push: (fileName, now = T0) => pushFile({ config, paths, api, fileName, now: () => now }),
    entry: (name) => getEntry(loadState(paths.state), name),
  };
  try {
    await fn(env);
  } finally {
    await fake.close();
  }
}

const versionPosts = (fake) => fake.log.filter((l) => l.startsWith('POST') && l.endsWith('/versions')).length;
const foreign = (parent, text) => buildVersion({
  representation: representationFor('a.md', Buffer.from(text)), parents: [parent], now: T1,
});

test('first push creates a record with a root version (test vector end to end)', async () => {
  await withEnv(async ({ fake, write, push, entry }) => {
    write('a.md', 'sample text');
    const r = await push('a.md');
    assert.equal(r.status, 'created');
    assert.equal(r.newRecord, true);
    assert.deepEqual(r.parents, []);
    assert.equal(r.versionHash, 'faf54a141b4e54ff72cbbf0baecfa58b72ddaf76b677bb83e2bfd18f2ee7cbe5');
    assert.equal(r.did, `did:rwp:${NS}:${r.recordId}`);
    assert.deepEqual(entry('a.md'), {
      recordId: r.recordId,
      head: r.versionHash,
      contentHash: 'f222dc6bc4ee1924aef96421bde393ae1c83598c5118db9c9c68f59489154bca',
    });
    assert.equal(fake.records.size, 1);
  });
});

test('pushing an unchanged file creates no version', async () => {
  await withEnv(async ({ fake, write, push }) => {
    write('a.md', 'sample text');
    const first = await push('a.md');
    const second = await push('a.md', T1);
    assert.equal(second.status, 'unchanged');
    assert.equal(second.versionHash, first.versionHash);
    assert.equal(versionPosts(fake), 1);
  });
});

test('a changed file becomes a child of the current head', async () => {
  await withEnv(async ({ fake, write, push, entry }) => {
    write('a.md', 'sample text');
    const first = await push('a.md');
    write('a.md', 'changed text');
    const second = await push('a.md', T1);
    assert.equal(second.status, 'created');
    assert.equal(second.newRecord, false);
    assert.deepEqual(second.parents, [first.versionHash]);
    assert.equal(second.recordId, first.recordId);
    assert.equal(entry('a.md').head, second.versionHash);
    assert.equal(fake.records.get(`${NS}/${first.recordId}`).size, 2);
    assert.ok(fake.log.some((l) => l.endsWith('/sync')));
  });
});

test('a newer version on the server stops the push (head-changed)', async () => {
  await withEnv(async ({ fake, write, push, entry }) => {
    write('a.md', 'sample text');
    const first = await push('a.md');
    fake.seed(NS, first.recordId, foreign(first.versionHash, 'other device'));
    write('a.md', 'local edit');
    await assert.rejects(push('a.md', T1), { code: 'head-changed' });
    assert.equal(entry('a.md').head, first.versionHash);
    assert.equal(versionPosts(fake), 1);
  });
});

test('several heads on the server stop the push (multiple-heads)', async () => {
  await withEnv(async ({ fake, write, push }) => {
    write('a.md', 'sample text');
    const first = await push('a.md');
    fake.seed(NS, first.recordId, foreign(first.versionHash, 'branch one'));
    fake.seed(NS, first.recordId, foreign(first.versionHash, 'branch two'));
    write('a.md', 'local edit');
    await assert.rejects(push('a.md', T1), { code: 'multiple-heads' });
  });
});

test('a record unknown to the server is reported (record-missing)', async () => {
  await withEnv(async ({ fake, write, push }) => {
    write('a.md', 'sample text');
    await push('a.md');
    fake.records.clear();
    write('a.md', 'changed text');
    await assert.rejects(push('a.md', T1), { code: 'record-missing' });
  });
});

test('a missing file fails before any network request', async () => {
  await withEnv(async ({ fake, push }) => {
    await assert.rejects(push('nope.md'), { code: 'file-not-found' });
    assert.equal(fake.log.length, 0);
  });
});

test('history and graph of three pushed versions', async () => {
  await withEnv(async ({ write, push, config, paths, api, entry }) => {
    write('a.md', 'one');
    await push('a.md', T0);
    write('a.md', 'two');
    await push('a.md', T1);
    write('a.md', 'three');
    await push('a.md', T2);

    const { versions, heads } = await loadHistory({ config, paths, api, fileName: 'a.md' });
    assert.equal(versions.length, 3);
    assert.equal(heads.length, 1);
    const lines = renderGraph({ versions, heads, localHead: entry('a.md').head }).split('\n');
    assert.equal(lines.filter((l) => l.startsWith('* ')).length, 3);
    assert.match(lines[0], /\(root\)/);
    assert.match(lines.at(-1), /\(head, local\)/);
    await assert.rejects(loadHistory({ config, paths, api, fileName: 'other.md' }), { code: 'not-tracked' });
  });
});
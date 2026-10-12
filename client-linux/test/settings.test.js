import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519KeyPair } from '../../core/index.js';
import { ApiClient } from '../lib/api.js';
import { validateConfig } from '../lib/config.js';
import { pathsIn } from '../lib/paths.js';
import { pushFile } from '../lib/push.js';
import { createLink, formatCreated, formatLinks, listLinks, revokeLinks } from '../lib/settings.js';
import { startFakeCustodian } from '../testlib/fake-custodian.js';

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const { privateKeyPem } = generateEd25519KeyPair();
const T = new Date('2026-10-10T13:00:00Z');
const tokenOf = (url) => url.split('/c/')[1];

async function withRecord(fn) {
  const fake = await startFakeCustodian();
  const root = mkdtempSync(join(tmpdir(), 'openrwp-settings-'));
  const paths = pathsIn(join(root, 'home'));
  const docsDir = join(root, 'docs');
  mkdirSync(docsDir);
  const config = validateConfig({ baseUrl: fake.baseUrl, namespace: NS, deviceLabel: 'Test', docsDir });
  const api = new ApiClient({ baseUrl: fake.baseUrl, privateKeyPem });
  writeFileSync(join(docsDir, 'a.md'), 'sample text');
  const pushed = await pushFile({ config, paths, api, fileName: 'a.md', now: () => T });
  const run = { config, paths, api, fileName: 'a.md' };
  try {
    await fn({ fake, paths, run, pushed, key: `${NS}/${pushed.recordId}` });
  } finally {
    await fake.close();
  }
}

test('create: one-time URL, default 7 days, direct file link, nothing stored locally', async () => {
  await withRecord(async ({ paths, run, pushed }) => {
    const r = await createLink({ ...run, now: () => T });
    assert.equal(r.expires, '2026-10-17T13:00:00Z');
    assert.match(r.url, /^https:\/\/example\.org\/openrwp\/c\/[A-Za-z0-9_-]{43}$/);
    assert.equal(r.fileUrl, `${r.url}/versions/${pushed.versionHash}/content`);

    const { links } = await listLinks(run);
    assert.equal(links.length, 1);
    assert.equal(links[0].id, r.id);
    assert.equal(links[0].url, undefined);
    assert.ok(!readFileSync(paths.state, 'utf8').includes(tokenOf(r.url)));
  });
});

test('a second link keeps the first one (same id, only known fields are sent back)', async () => {
  await withRecord(async ({ fake, run, key }) => {
    const first = await createLink({ ...run });
    const second = await createLink({ ...run });
    assert.notEqual(first.id, second.id);
    assert.deepEqual(fake.links.get(key).map((l) => l.id), [first.id, second.id]);
    assert.deepEqual(fake.revoked, []);
  });
});

test('revoke one link by id prefix', async () => {
  await withRecord(async ({ fake, run }) => {
    const first = await createLink({ ...run });
    const second = await createLink({ ...run });
    const { revoked } = await revokeLinks({ ...run, idPrefix: first.id.slice(0, 8) });
    assert.deepEqual(revoked, [first.id]);
    assert.deepEqual(fake.revoked, [first.id]);
    assert.deepEqual((await listLinks(run)).links.map((l) => l.id), [second.id]);
  });
});

test('revoke needs a usable prefix and an existing link', async () => {
  await withRecord(async ({ run }) => {
    await createLink({ ...run });
    await assert.rejects(revokeLinks({ ...run, idPrefix: 'a' }), { code: 'invalid-argument' });
    await assert.rejects(revokeLinks({ ...run, idPrefix: 'zzzz' }), { code: 'link-not-found' });
  });
});

test('revoke all', async () => {
  await withRecord(async ({ run }) => {
    await createLink({ ...run });
    await createLink({ ...run });
    assert.equal((await revokeLinks({ ...run, all: true })).revoked.length, 2);
    assert.deepEqual((await listLinks(run)).links, []);
    await assert.rejects(revokeLinks({ ...run, all: true }), { code: 'link-not-found' });
  });
});

test('days: 1 to 30 whole days, checked before any request', async () => {
  await withRecord(async ({ fake, run }) => {
    for (const days of [0, 31, 1.5, Number.NaN, '3']) {
      await assert.rejects(createLink({ ...run, days }), { code: 'invalid-argument' }, String(days));
    }
    assert.ok(!fake.log.some((l) => l.startsWith('PUT')));
    const r = await createLink({ ...run, days: 3, now: () => T });
    assert.equal(r.expires, '2026-10-13T13:00:00Z');
  });
});

test('a file that was never pushed has no links', async () => {
  await withRecord(async ({ run }) => {
    await assert.rejects(createLink({ ...run, fileName: 'other.md' }), { code: 'not-tracked' });
    await assert.rejects(listLinks({ ...run, fileName: 'other.md' }), { code: 'not-tracked' });
  });
});

test('output formats', () => {
  assert.equal(formatLinks([]), 'No capability links.');
  const link = { id: '28b91a20-f7cd-456b-a290-5d7088fdba74', modes: ['read'], scope: 'record', expires: '2026-01-01T00:00:00Z' };
  assert.match(formatLinks([link], T), /28b91a20 {2}read {2}record {2}2026-01-01T00:00:00Z {2}\(expired\)/);
  const text = formatCreated({
    id: link.id, url: 'https://example.org/openrwp/c/TOKEN', expires: link.expires,
    version: 'a'.repeat(64), fileUrl: 'https://example.org/openrwp/c/TOKEN/versions/x/content',
  }, 'a.md');
  assert.match(text, /shown only once/);
  assert.match(text, /--revoke 28b91a20/);
});
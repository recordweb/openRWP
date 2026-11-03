import test from 'node:test';
import assert from 'node:assert/strict';
import { computeContentHash, createRepresentation, validateRepresentation } from '../index.js';
import { rootSchema, rootAgent } from './vectors.js';

test('the contentHash of the root records is reproduced', async () => {
  for (const record of [rootSchema, rootAgent]) {
    const rep = record.payload[0].representations[0];
    assert.equal(await computeContentHash(rep), rep.contentHash);
    await validateRepresentation(rep);
  }
});

test('createRepresentation hashes a markdown source', async () => {
  const rep = await createRepresentation({ format: 'text/markdown', content: '# Title\n', role: 'source' });
  assert.equal(rep.primary, true);
  assert.match(rep.contentHash, /^sha256:[0-9a-f]{64}$/);
  await validateRepresentation(rep);
});

test('role is optional and not part of the hash when absent', async () => {
  const a = await createRepresentation({ format: 'text/markdown', content: 'x' });
  const b = await createRepresentation({ format: 'text/markdown', content: 'x', role: 'source' });
  assert.equal('role' in a, false);
  assert.notEqual(a.contentHash, b.contentHash);
});

test('changed content is detected', async () => {
  const rep = structuredClone(rootAgent.payload[0].representations[0]);
  rep.content.displayName = 'changed';
  await assert.rejects(() => validateRepresentation(rep), { code: 'content-hash-mismatch' });
});

test('references, binary formats and wrong content types are rejected', async () => {
  const ok = await createRepresentation({ format: 'text/markdown', content: 'x' });
  await assert.rejects(() => validateRepresentation({ ...ok, ref: 'https://example.org/x' }), { code: 'ref-not-supported' });
  await assert.rejects(() => validateRepresentation({ ...ok, extra: 1 }), { code: 'unknown-field' });
  const pdf = await createRepresentation({ format: 'application/pdf', content: 'AAAA' });
  await assert.rejects(() => validateRepresentation(pdf), { code: 'unsupported-format' });
  const wrong = await createRepresentation({ format: 'text/markdown', content: { a: 1 } });
  await assert.rejects(() => validateRepresentation(wrong), { code: 'invalid-representation' });
});

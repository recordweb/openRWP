import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlobStore } from '../blobs.js';

test('put is content-addressed, idempotent and leaves no temporary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blobs-'));
  const store = createBlobStore(dir);
  const a = await store.put(Buffer.from('abc'));
  const b = await store.put(Buffer.from('abc'));
  assert.equal(a.fileHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(a, b);
  assert.equal(a.size, 3);
  assert.equal((await store.get(a.fileHash)).toString(), 'abc');
  const files = await readdir(join(dir, 'ba'));
  assert.deepEqual(files, [a.fileHash]);
});

test('get returns null for unknown or malformed hashes', async () => {
  const store = createBlobStore(await mkdtemp(join(tmpdir(), 'blobs-')));
  assert.equal(await store.get('0'.repeat(64)), null);
  assert.equal(await store.get('../../etc/passwd'), null);
});
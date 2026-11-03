import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, sha256Ref, hashRef, stripHashRef, isHashRef } from '../index.js';

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('sha256Hex is bare lowercase hex', async () => {
  assert.equal(await sha256Hex('abc'), ABC);
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256Hex accepts bytes and strings alike', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), ABC);
});

test('hash references carry the prefix sha256:', async () => {
  assert.equal(await sha256Ref('abc'), `sha256:${ABC}`);
  assert.equal(hashRef(ABC), `sha256:${ABC}`);
  assert.equal(stripHashRef(`sha256:${ABC}`), ABC);
  assert.equal(isHashRef(`sha256:${ABC}`), true);
  assert.equal(isHashRef(ABC), false);
});

test('invalid hashes are rejected', () => {
  assert.throws(() => hashRef('abc'), { code: 'invalid-hash' });
  assert.throws(() => hashRef(ABC.toUpperCase()), { code: 'invalid-hash' });
  assert.throws(() => stripHashRef(ABC), { code: 'invalid-hash' });
});

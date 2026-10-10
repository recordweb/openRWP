import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, sha256Hex, encodeBase64, decodeBase64Strict } from '../index.js';

test('canonicalize sorts keys and drops whitespace', () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
});

test('canonicalize matches the RFC 8785 example', () => {
  const input = JSON.parse(String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"/","literals":[null,true,false]}`);
  const expected = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;
  assert.equal(canonicalize(input), expected);
});

test('canonicalize normalises strings to NFC', () => {
  assert.equal(canonicalize({ k: 'e\u0301' }), canonicalize({ k: '\u00e9' }));
});

test('canonicalize ignores undefined properties', () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
});

test('sha256Hex is bare lowercase hex', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('base64 round trip is strict', () => {
  const bytes = Buffer.from('sample text');
  assert.equal(encodeBase64(bytes), 'c2FtcGxlIHRleHQ=');
  assert.deepEqual(decodeBase64Strict('c2FtcGxlIHRleHQ='), bytes);
  assert.throws(() => decodeBase64Strict('c2FtcGxlIHRleHQ'), { code: 'invalid-base64' });
  assert.throws(() => decodeBase64Strict('c2Ft cGxl'), { code: 'invalid-base64' });
});
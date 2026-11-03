import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The core must run unchanged in browsers: no Node.js modules, no Buffer.
// dpop.js and encoding.js belong to the RWP 0.0.8 client/server binding and are not part of this list.
const MIGRATED = [
  'bytes', 'canonical', 'did-document', 'errors', 'graph', 'hash', 'ids', 'keys',
  'multibase', 'proof', 'record', 'representation', 'version',
];

for (const name of MIGRATED) {
  test(`src/${name}.js does not depend on Node.js`, () => {
    const source = readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:/);
    assert.doesNotMatch(source, /\bBuffer\b/);
    assert.doesNotMatch(source, /\brequire\(/);
  });
}

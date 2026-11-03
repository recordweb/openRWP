import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The core must run unchanged in browsers: no Node.js modules, no Buffer.
// The list grows as modules are migrated to RWP 0.0.12.
const MIGRATED = ['bytes', 'canonical', 'errors', 'hash', 'ids', 'keys', 'multibase'];

for (const name of MIGRATED) {
  test(`src/${name}.js does not depend on Node.js`, () => {
    const source = readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:/);
    assert.doesNotMatch(source, /\bBuffer\b/);
    assert.doesNotMatch(source, /\brequire\(/);
  });
}

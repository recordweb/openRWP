import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, newConfig, saveConfig, validateConfig } from '../lib/config.js';
import { pathsIn } from '../lib/paths.js';

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const base = { baseUrl: 'https://example.org/openrwp/', namespace: NS, deviceLabel: ' Laptop ', docsDir: '/tmp/docs' };
const tmp = () => pathsIn(join(mkdtempSync(join(tmpdir(), 'openrwp-')), 'home'));

test('validateConfig normalises URL and label', () => {
  const cfg = validateConfig(base);
  assert.equal(cfg.baseUrl, 'https://example.org/openrwp');
  assert.equal(cfg.deviceLabel, 'Laptop');
});

test('http is allowed for loopback only', () => {
  assert.doesNotThrow(() => validateConfig({ ...base, baseUrl: 'http://127.0.0.1:3000' }));
  assert.throws(() => validateConfig({ ...base, baseUrl: 'http://example.org' }), { code: 'invalid-config' });
});

test('validateConfig rejects bad values', () => {
  for (const patch of [
    { namespace: 'nope' }, { deviceLabel: ' ' }, { docsDir: 'relative/dir' },
    { baseUrl: 'not a url' }, { baseUrl: 'https://example.org/x?y=1' },
  ]) {
    assert.throws(() => validateConfig({ ...base, ...patch }), { code: 'invalid-config' }, JSON.stringify(patch));
  }
});

test('newConfig uses the default base URL and docs folder', () => {
  const cfg = newConfig({ namespace: NS, deviceLabel: 'Laptop' });
  assert.equal(cfg.baseUrl, 'https://vps.recordweb.dev/openrwp');
  assert.ok(cfg.docsDir.endsWith('OpenRWP'));
});

test('save and load round trip, file is owner-only', () => {
  const paths = tmp();
  assert.equal(loadConfig(paths), undefined);
  saveConfig(paths, base);
  assert.deepEqual(loadConfig(paths), validateConfig(base));
  assert.equal(statSync(paths.config).mode & 0o777, 0o600);
  assert.equal(statSync(paths.dir).mode & 0o777, 0o700);
});

test('corrupt config file is reported', () => {
  const paths = tmp();
  saveConfig(paths, base);
  writeFileSync(paths.config, '{ not json');
  assert.throws(() => loadConfig(paths), { code: 'corrupt-file' });
});
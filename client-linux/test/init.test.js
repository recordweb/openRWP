import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateEd25519KeyPair, isUuidV4 } from '../../core/index.js';
import { formatInitReport, runInit } from '../lib/init.js';
import { pathsIn } from '../lib/paths.js';
import { startFakeServer } from '../testlib/fake-server.js';

const NS = '4d3c45e8-1785-4f52-90f7-b9f5811935ad';
const OTHER_NS = '28b91a20-f7cd-456b-a290-5d7088fdba74';

const mkPaths = () => pathsIn(join(mkdtempSync(join(tmpdir(), 'openrwp-init-')), 'home'));
const options = (fake, paths, extra = {}) => ({
  paths, baseUrl: fake.baseUrl, deviceLabel: 'Test laptop', docsDir: join(dirname(paths.dir), 'docs'), ...extra,
});

async function withFake(fakeOptions, fn) {
  const fake = await startFakeServer(fakeOptions);
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
}

function writeKeys(paths) {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.authorKey, generateEd25519KeyPair().privateKeyPem, { mode: 0o600 });
  writeFileSync(paths.deviceKey, generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
}

test('fresh init creates keys, config and folder; device is not registered yet', async () => {
  await withFake({ devices: new Set() }, async (fake) => {
    const paths = mkPaths();
    const r = await runInit(options(fake, paths));
    assert.ok(isUuidV4(r.namespace));
    assert.ok(r.authorPublicKey.startsWith('z6Mk'));
    assert.ok(r.devicePublicKeyX.length > 20);
    assert.deepEqual(r.reused, { config: false, author: false, device: false });
    assert.equal(r.access.status, 'not-registered');
    assert.equal(statSync(paths.authorKey).mode & 0o777, 0o600);
    assert.equal(statSync(paths.deviceKey).mode & 0o777, 0o600);
    assert.ok(existsSync(paths.config));
    assert.ok(statSync(r.docsDir).isDirectory());
  });
});

test('second init reuses everything, changes nothing and confirms access', async () => {
  await withFake({ devices: new Set() }, async (fake) => {
    const paths = mkPaths();
    const first = await runInit(options(fake, paths));
    fake.devices.add(first.deviceThumbprint);
    const before = [paths.authorKey, paths.deviceKey, paths.config].map((f) => readFileSync(f, 'utf8'));

    const second = await runInit(options(fake, paths));
    assert.deepEqual(second.reused, { config: true, author: true, device: true });
    assert.equal(second.namespace, first.namespace);
    assert.equal(second.authorPublicKey, first.authorPublicKey);
    assert.equal(second.devicePublicKeyX, first.devicePublicKeyX);
    assert.equal(second.docsDirCreated, false);
    assert.equal(second.access.status, 'ok');
    assert.deepEqual([paths.authorKey, paths.deviceKey, paths.config].map((f) => readFileSync(f, 'utf8')), before);
  });
});

test('a 403 from the server means wrong namespace', async () => {
  await withFake({}, async (fake) => {
    fake.handler = () => ({ status: 403, json: { error: 'forbidden' } });
    const r = await runInit(options(fake, mkPaths()));
    assert.equal(r.access.status, 'wrong-namespace');
  });
});

test('existing keys without config.json need --namespace', async () => {
  await withFake({}, async (fake) => {
    const paths = mkPaths();
    writeKeys(paths);
    await assert.rejects(runInit(options(fake, paths)), { code: 'namespace-required' });
    assert.equal(existsSync(paths.config), false);
  });
});

test('existing keys are reused when the namespace is given', async () => {
  await withFake({}, async (fake) => {
    const paths = mkPaths();
    writeKeys(paths);
    const keys = [paths.authorKey, paths.deviceKey].map((f) => readFileSync(f, 'utf8'));
    const r = await runInit(options(fake, paths, { namespace: NS }));
    assert.equal(r.namespace, NS);
    assert.deepEqual(r.reused, { config: false, author: true, device: true });
    assert.equal(JSON.parse(readFileSync(paths.config, 'utf8')).namespace, NS);
    assert.deepEqual([paths.authorKey, paths.deviceKey].map((f) => readFileSync(f, 'utf8')), keys);
  });
});

test('different options than the existing config.json are a conflict', async () => {
  await withFake({}, async (fake) => {
    const paths = mkPaths();
    await runInit(options(fake, paths, { namespace: NS }));
    await assert.rejects(runInit(options(fake, paths, { namespace: OTHER_NS })), { code: 'config-conflict' });
  });
});

test('a key that is not Ed25519 is rejected', async () => {
  await withFake({}, async (fake) => {
    const paths = mkPaths();
    mkdirSync(paths.dir, { recursive: true });
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' });
    writeFileSync(paths.authorKey, ec, { mode: 0o600 });
    await assert.rejects(runInit(options(fake, paths, { namespace: NS })), { code: 'invalid-key' });
  });
});

test('a key file readable by others produces a warning', async () => {
  await withFake({}, async (fake) => {
    const paths = mkPaths();
    writeKeys(paths);
    chmodSync(paths.deviceKey, 0o644);
    const r = await runInit(options(fake, paths, { namespace: NS }));
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /chmod 600/);
  });
});

test('an unreachable server is reported, init still completes', async () => {
  const fake = await startFakeServer();
  const paths = mkPaths();
  const opts = options(fake, paths);
  await fake.close();
  const r = await runInit(opts);
  assert.equal(r.access.status, 'unreachable');
  assert.ok(existsSync(paths.config));
});

test('the report shows the three admin values and no private key', async () => {
  await withFake({ devices: new Set() }, async (fake) => {
    const r = await runInit(options(fake, mkPaths()));
    const text = formatInitReport(r);
    for (const value of [r.namespace, r.authorPublicKey, r.devicePublicKeyX]) assert.ok(text.includes(value));
    assert.ok(!text.includes('PRIVATE KEY'));
    assert.match(text, /Not registered yet/);
  });
});
import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import {
  generateEd25519KeyPair, jwkThumbprint, publicJwkFromPrivateKeyPem, publicKeyToMultibase,
} from '../../core/index.js';
import { ApiClient, ApiError } from './api.js';
import { loadConfig, newConfig, saveConfig, validateConfig } from './config.js';
import { ClientError } from './errors.js';
import { ensurePrivateDir } from './fsutil.js';

// Returns the PEM text, or undefined if the file does not exist. Rejects anything but an Ed25519 private key.
function readEd25519Key(file) {
  let pem;
  try {
    pem = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new ClientError('invalid-key', `${file} is not a private key in PEM format`);
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new ClientError('invalid-key', `${file} is not an Ed25519 key`);
  return pem;
}

// Uses the existing key, or creates a new file (mode 600, never overwrites).
function useOrCreateKey(file, existing, generate) {
  if (existing) return { pem: existing, reused: true };
  const pem = generate();
  writeFileSync(file, pem, { mode: 0o600, flag: 'wx' });
  return { pem, reused: false };
}

const generateDevicePem = () => generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
const authorPublicKey = (pem) => publicKeyToMultibase(Buffer.from(publicJwkFromPrivateKeyPem(pem).x, 'base64url'));

function permissionWarning(file) {
  const mode = statSync(file).mode & 0o777;
  return mode & 0o077 ? `${file} is accessible by other users (mode ${mode.toString(8)}); run: chmod 600 ${file}` : undefined;
}

// Asks the custodian for a random record of the namespace: 404 = device and namespace are fine, 403 = wrong namespace.
export async function probeAccess(api, namespace) {
  try {
    await api.getRecord(namespace, randomUUID());
    return { status: 'unexpected', detail: 'the server returned a record for a random id' };
  } catch (err) {
    if (err.code === 'device-not-registered') return { status: 'not-registered' };
    if (err.code === 'network') return { status: 'unreachable', detail: err.message };
    if (err instanceof ApiError && err.status === 404) return { status: 'ok' };
    if (err instanceof ApiError && err.status === 403) return { status: 'wrong-namespace' };
    return { status: 'unexpected', detail: err.message };
  }
}

// Creates what is missing (keys, config.json, document folder), reuses what exists, then checks access.
export async function runInit({
  paths, namespace, deviceLabel, baseUrl, docsDir, makeApi = (options) => new ApiClient(options),
}) {
  ensurePrivateDir(paths.dir);
  const existingAuthor = readEd25519Key(paths.authorKey);
  const existingDevice = readEd25519Key(paths.deviceKey);

  let config = loadConfig(paths);
  const configReused = config !== undefined;
  if (configReused) {
    const provided = Object.fromEntries(
      Object.entries({ namespace, deviceLabel, baseUrl, docsDir }).filter(([, v]) => v !== undefined),
    );
    const merged = validateConfig({ ...config, ...provided });
    if (JSON.stringify(merged) !== JSON.stringify(config)) {
      throw new ClientError('config-conflict', `${paths.config} already exists with different values; edit or remove it`);
    }
  } else {
    if (!namespace && (existingAuthor || existingDevice)) {
      throw new ClientError('namespace-required', 'keys exist but there is no config.json: pass --namespace <uuid> of your registered namespace');
    }
    config = newConfig({ namespace: namespace ?? randomUUID(), deviceLabel: deviceLabel ?? hostname(), baseUrl, docsDir });
  }

  const author = useOrCreateKey(paths.authorKey, existingAuthor, () => generateEd25519KeyPair().privateKeyPem);
  const device = useOrCreateKey(paths.deviceKey, existingDevice, generateDevicePem);
  if (!configReused) saveConfig(paths, config);
  const docsDirCreated = !existsSync(config.docsDir);
  mkdirSync(config.docsDir, { recursive: true });

  const deviceJwk = publicJwkFromPrivateKeyPem(device.pem);
  const access = await probeAccess(makeApi({ baseUrl: config.baseUrl, privateKeyPem: device.pem }), config.namespace);

  return {
    namespace: config.namespace,
    authorPublicKey: authorPublicKey(author.pem),
    devicePublicKeyX: deviceJwk.x,
    deviceThumbprint: jwkThumbprint(deviceJwk),
    deviceLabel: config.deviceLabel,
    baseUrl: config.baseUrl,
    docsDir: config.docsDir,
    docsDirCreated,
    files: { config: paths.config, authorKey: paths.authorKey, deviceKey: paths.deviceKey },
    reused: { config: configReused, author: author.reused, device: device.reused },
    warnings: [permissionWarning(paths.authorKey), permissionWarning(paths.deviceKey)].filter(Boolean),
    access,
  };
}

const ACCESS_TEXT = {
  ok: () => 'OK: the device is registered and the namespace matches.',
  'not-registered': () => 'Not registered yet: send the values above to the administrator, then run "openrwp init" again.',
  'wrong-namespace': () => 'The server rejects this namespace for this device (403). Check the namespace in config.json.',
  unreachable: (a) => `Server not reachable: ${a.detail}`,
  unexpected: (a) => `Unexpected answer: ${a.detail}`,
};

export function formatInitReport(r) {
  const state = (reused) => (reused ? 'existing' : 'created');
  return [
    'OpenRWP client initialised.',
    `  config:        ${r.files.config} (${state(r.reused.config)})`,
    `  author key:    ${r.files.authorKey} (${state(r.reused.author)})`,
    `  device key:    ${r.files.deviceKey} (${state(r.reused.device)})`,
    `  documents:     ${r.docsDir} (${r.docsDirCreated ? 'created' : 'existing'})`,
    `  custodian:     ${r.baseUrl}`,
    ...r.warnings.map((w) => `  WARNING: ${w}`),
    '',
    'Values for the administrator (not secret):',
    `  Namespace UUID:        ${r.namespace}`,
    `  Author public key:     ${r.authorPublicKey}`,
    `  Device public key (x): ${r.devicePublicKeyX}`,
    `  Device label:          ${r.deviceLabel}`,
    '',
    `Server check: ${ACCESS_TEXT[r.access.status](r.access)}`,
  ].join('\n');
}
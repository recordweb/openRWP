import { isAbsolute } from 'node:path';
import { isUuidV4 } from '../../core/index.js';
import { ClientError } from './errors.js';
import { readJsonIfExists, writeFileAtomic, ensurePrivateDir } from './fsutil.js';
import { defaultDocsDir } from './paths.js';

export const DEFAULT_BASE_URL = 'https://vps.recordweb.dev/openrwp';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const bad = (detail) => new ClientError('invalid-config', detail);

// Checks a config object and returns a normalised copy (base URL without trailing slash).
export function validateConfig(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw bad('config must be an object');

  let url;
  try {
    url = new URL(cfg.baseUrl);
  } catch {
    throw bad('baseUrl is not a valid URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw bad('baseUrl must use https (http only for localhost)');
  }
  if (url.search || url.hash) throw bad('baseUrl must not have a query or fragment');

  if (!isUuidV4(cfg.namespace)) throw bad('namespace must be a UUIDv4');
  if (typeof cfg.deviceLabel !== 'string' || cfg.deviceLabel.trim() === '') throw bad('deviceLabel is required');
  if (typeof cfg.docsDir !== 'string' || !isAbsolute(cfg.docsDir)) throw bad('docsDir must be an absolute path');

  return {
    baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
    namespace: cfg.namespace,
    deviceLabel: cfg.deviceLabel.trim(),
    docsDir: cfg.docsDir,
  };
}

export function newConfig({ namespace, deviceLabel, baseUrl = DEFAULT_BASE_URL, docsDir = defaultDocsDir() }) {
  return validateConfig({ baseUrl, namespace, deviceLabel, docsDir });
}

// Returns undefined if no config exists yet.
export function loadConfig(paths) {
  const raw = readJsonIfExists(paths.config);
  return raw === undefined ? undefined : validateConfig(raw);
}

export function saveConfig(paths, cfg) {
  ensurePrivateDir(paths.dir);
  writeFileAtomic(paths.config, `${JSON.stringify(validateConfig(cfg), null, 2)}\n`);
}
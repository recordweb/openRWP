import { isHash, isUuidV4 } from '../../core/index.js';
import { ClientError } from './errors.js';
import { readJsonIfExists, writeFileAtomic, ensurePrivateDir } from './fsutil.js';
import { dirname } from 'node:path';

// state.json: { version: 1, files: { "<file name>": { recordId, head, contentHash } } }
// The file name is the key (flat document folder, demo scope). It is only a cache of the server state:
// `head` is the versionHash of the last version known locally, `contentHash` the hash of the last pushed file.
export const STATE_VERSION = 1;

// Demo scope: flat folder. Hidden names are rejected (editors create lock files like ".~lock.x.odt#").
export function validateFileName(name) {
  const bad = (detail) => new ClientError('invalid-file-name', `${detail}: ${JSON.stringify(name)}`);
  if (typeof name !== 'string' || name === '') throw bad('empty name');
  if (name.includes('/') || name.includes('\0')) throw bad('only files directly in the folder are supported');
  if (name.startsWith('.')) throw bad('hidden files are not supported');
  if (Buffer.byteLength(name) > 255) throw bad('name too long');
  return name;
}

function validateEntry(entry) {
  const bad = (detail) => new ClientError('invalid-state', detail);
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw bad('entry must be an object');
  if (!isUuidV4(entry.recordId)) throw bad('recordId must be a UUIDv4');
  if (entry.head !== null && !isHash(entry.head)) throw bad('head must be a hash or null');
  if (entry.contentHash !== null && !isHash(entry.contentHash)) throw bad('contentHash must be a hash or null');
  return { recordId: entry.recordId, head: entry.head, contentHash: entry.contentHash };
}

export const emptyState = () => ({ version: STATE_VERSION, files: {} });

export function loadState(file) {
  const raw = readJsonIfExists(file);
  if (raw === undefined) return emptyState();
  if (raw === null || typeof raw !== 'object' || raw.version !== STATE_VERSION
    || raw.files === null || typeof raw.files !== 'object' || Array.isArray(raw.files)) {
    throw new ClientError('invalid-state', `${file} has an unknown format`);
  }
  const files = {};
  for (const [name, entry] of Object.entries(raw.files)) files[validateFileName(name)] = validateEntry(entry);
  return { version: STATE_VERSION, files };
}

export function saveState(file, state) {
  ensurePrivateDir(dirname(file));
  writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function getEntry(state, name) {
  validateFileName(name);
  return Object.hasOwn(state.files, name) ? state.files[name] : undefined;
}

export function setEntry(state, name, entry) {
  state.files[validateFileName(name)] = validateEntry(entry);
}

export function removeEntry(state, name) {
  validateFileName(name);
  return Object.hasOwn(state.files, name) && delete state.files[name];
}

// Name of the file that belongs to a record, if any.
export function findByRecord(state, recordId) {
  return Object.keys(state.files).find((name) => state.files[name].recordId === recordId);
}
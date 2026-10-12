import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ClientError } from './errors.js';

// Private directory (owner only), created if missing.
export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// Writes to a temp file and renames it, so a crash never leaves a half-written file.
export function writeFileAtomic(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, data, { mode, flag: 'wx' });
  renameSync(tmp, file);
}

// Returns the parsed JSON, or undefined if the file does not exist.
export function readJsonIfExists(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ClientError('corrupt-file', `${file} is not valid JSON`);
  }
}
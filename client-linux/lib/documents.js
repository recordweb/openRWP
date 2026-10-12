import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { computeContentHash, computeVersionHash, encodeBase64 } from '../../core/index.js';
import { ClientError } from './errors.js';
import { validateFileName } from './state.js';

// Same formats as core/bin/make-version.js.
export const FORMATS = {
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
};

// Request limit of the custodian (README: 25 MB). Base64 makes the body one third larger than the file.
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const REQUEST_OVERHEAD_BYTES = 2048;

export const formatFor = (name) => FORMATS[extname(name).toLowerCase()] ?? 'application/octet-stream';

// Demo scope: documents live directly in docsDir. Accepts "a.odt" or a path to a file in docsDir.
export function resolveDocName(docsDir, arg) {
  if (typeof arg !== 'string' || arg === '') throw new ClientError('invalid-argument', 'a file name is required');
  if (!arg.includes('/')) return validateFileName(arg);
  const abs = resolve(arg);
  let dir = dirname(abs);
  let want = docsDir;
  try {
    dir = realpathSync(dir);
    want = realpathSync(docsDir);
  } catch {
    // a missing folder cannot match; compare the plain paths
  }
  if (dir !== want) throw new ClientError('outside-docs-dir', `demo scope: documents must be directly in ${docsDir}`);
  return validateFileName(basename(abs));
}

// Reads a regular file from docsDir (symbolic links and folders are rejected).
export function readDocument(docsDir, name) {
  const file = join(docsDir, validateFileName(name));
  let stat;
  try {
    stat = lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') throw new ClientError('file-not-found', file);
    throw err;
  }
  if (!stat.isFile()) throw new ClientError('not-a-file', `${file} is not a regular file`);
  return readFileSync(file);
}

// The primary representation of a file (RWP 7.4): Base64 content plus contentHash.
export function representationFor(name, bytes) {
  if (Math.ceil(bytes.length / 3) * 4 + REQUEST_OVERHEAD_BYTES > MAX_REQUEST_BYTES) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1);
    throw new ClientError('file-too-large', `${name} is ${mb} MB; the custodian accepts requests of at most 25 MB (Base64 adds one third)`);
  }
  const representation = { format: formatFor(name), content: encodeBase64(bytes), primary: true, role: 'source' };
  representation.contentHash = computeContentHash(representation);
  return representation;
}

// One draft version. createdAt and modifiedAt are the same moment (demo decision).
export function buildVersion({ representation, parents, now = new Date() }) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const version = { state: 'draft', parents, createdAt: stamp, modifiedAt: stamp, representations: [representation] };
  version.versionHash = computeVersionHash(version);
  return version;
}
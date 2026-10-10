#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { computeContentHash, computeVersionHash, encodeBase64 } from '../index.js';

// Usage: node core/bin/make-version.js <file> [--parent <versionHash>]... [--format <mime>]
// Prints one draft version (JSON) for POST /records/<ns>/<rec>/versions. Test helper, not signed.
const FORMATS = {
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
};

const [file, ...rest] = process.argv.slice(2);
const parents = [];
let format;
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] === '--parent' && rest[i + 1]) {
    parents.push(rest[i + 1]);
  } else if (rest[i] === '--format' && rest[i + 1]) {
    format = rest[i + 1];
  } else {
    console.error(`Unknown argument: ${rest[i]}`);
    process.exit(2);
  }
}
if (!file) {
  console.error('Usage: node core/bin/make-version.js <file> [--parent <versionHash>]... [--format <mime>]');
  process.exit(2);
}

const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const representation = {
  format: format ?? FORMATS[extname(file).toLowerCase()] ?? 'application/octet-stream',
  content: encodeBase64(readFileSync(file)),
  primary: true,
  role: 'source',
};
representation.contentHash = computeContentHash(representation);
const version = { state: 'draft', parents, createdAt: now, modifiedAt: now, representations: [representation] };
version.versionHash = computeVersionHash(version);
console.log(JSON.stringify(version));
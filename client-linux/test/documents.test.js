import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateVersion } from '../../core/index.js';
import { buildVersion, formatFor, readDocument, representationFor, resolveDocName } from '../lib/documents.js';

const docs = () => mkdtempSync(join(tmpdir(), 'openrwp-docs-'));

test('formats follow the file extension', () => {
  assert.equal(formatFor('a.odt'), 'application/vnd.oasis.opendocument.text');
  assert.equal(formatFor('A.MD'), 'text/markdown');
  assert.equal(formatFor('data.bin'), 'application/octet-stream');
});

test('resolveDocName accepts a name or a path inside the folder', () => {
  const dir = docs();
  assert.equal(resolveDocName(dir, 'a.odt'), 'a.odt');
  assert.equal(resolveDocName(dir, join(dir, 'a.odt')), 'a.odt');
});

test('resolveDocName rejects other folders and hidden names', () => {
  const dir = docs();
  assert.throws(() => resolveDocName(dir, '/tmp/elsewhere/a.odt'), { code: 'outside-docs-dir' });
  assert.throws(() => resolveDocName(dir, '.hidden'), { code: 'invalid-file-name' });
  assert.throws(() => resolveDocName(dir, ''), { code: 'invalid-argument' });
});

test('readDocument reads files and rejects folders, links and missing files', () => {
  const dir = docs();
  writeFileSync(join(dir, 'real'), 'abc');
  mkdirSync(join(dir, 'folder'));
  symlinkSync(join(dir, 'real'), join(dir, 'link'));
  assert.equal(readDocument(dir, 'real').toString(), 'abc');
  assert.throws(() => readDocument(dir, 'folder'), { code: 'not-a-file' });
  assert.throws(() => readDocument(dir, 'link'), { code: 'not-a-file' });
  assert.throws(() => readDocument(dir, 'nope'), { code: 'file-not-found' });
});

test('test vectors of the change list (A13) and a valid version', () => {
  const representation = representationFor('x.md', Buffer.from('sample text'));
  assert.equal(representation.content, 'c2FtcGxlIHRleHQ=');
  assert.equal(representation.contentHash, 'f222dc6bc4ee1924aef96421bde393ae1c83598c5118db9c9c68f59489154bca');

  const version = buildVersion({ representation, parents: [], now: new Date('2026-10-10T13:00:00Z') });
  assert.equal(version.createdAt, '2026-10-10T13:00:00Z');
  assert.equal(version.modifiedAt, version.createdAt);
  assert.equal(version.versionHash, 'faf54a141b4e54ff72cbbf0baecfa58b72ddaf76b677bb83e2bfd18f2ee7cbe5');
  assert.doesNotThrow(() => validateVersion(version, { allowedStates: ['draft'] }));
});

test('a file that is too large for one request is rejected before hashing', () => {
  assert.throws(() => representationFor('big.pdf', Buffer.alloc(19 * 1024 * 1024)), { code: 'file-too-large' });
});
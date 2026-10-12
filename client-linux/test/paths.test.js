import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDocsDir, documentsDir, parseUserDirs } from '../lib/paths.js';

const HOME = '/home/nik';
const SAMPLE = '# comment\nXDG_DESKTOP_DIR="$HOME/Schreibtisch"\nXDG_DOCUMENTS_DIR="$HOME/Dokumente"\n';

function configHome(content) {
  const dir = mkdtempSync(join(tmpdir(), 'openrwp-xdg-'));
  if (content !== undefined) writeFileSync(join(dir, 'user-dirs.dirs'), content);
  return { home: HOME, env: { XDG_CONFIG_HOME: dir } };
}

test('parseUserDirs expands $HOME and ignores other entries', () => {
  assert.equal(parseUserDirs(SAMPLE, HOME), '/home/nik/Dokumente');
  assert.equal(parseUserDirs('XDG_DOCUMENTS_DIR="/data/docs"\n', HOME), '/data/docs');
  assert.equal(parseUserDirs('XDG_DESKTOP_DIR="$HOME/Desktop"\n', HOME), undefined);
  assert.equal(parseUserDirs('XDG_DOCUMENTS_DIR="relative"\n', HOME), undefined);
});

test('documentsDir reads user-dirs.dirs', () => {
  assert.equal(documentsDir(configHome(SAMPLE)), '/home/nik/Dokumente');
});

test('documentsDir falls back to ~/Documents', () => {
  assert.equal(documentsDir(configHome(undefined)), '/home/nik/Documents');
  assert.equal(documentsDir(configHome('XDG_DOCUMENTS_DIR="$HOME/"\n')), '/home/nik/Documents');
});

test('default docs folder is <documents>/openRWP', () => {
  assert.equal(defaultDocsDir(configHome(SAMPLE)), '/home/nik/Dokumente/openRWP');
});
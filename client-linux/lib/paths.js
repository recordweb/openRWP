import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const DOCS_FOLDER_NAME = 'openRWP';

// OPENRWP_HOME overrides ~/.openrwp (used by tests).
export function homeDir(env = process.env) {
  return env.OPENRWP_HOME ?? join(homedir(), '.openrwp');
}

export function pathsIn(dir = homeDir()) {
  return {
    dir,
    config: join(dir, 'config.json'),
    state: join(dir, 'state.json'),
    authorKey: join(dir, 'author.pem'),
    deviceKey: join(dir, 'device.pem'),
  };
}

// Reads XDG_DOCUMENTS_DIR from the text of ~/.config/user-dirs.dirs, e.g. XDG_DOCUMENTS_DIR="$HOME/Dokumente".
export function parseUserDirs(text, home) {
  const match = /^\s*XDG_DOCUMENTS_DIR\s*=\s*"([^"\n]*)"/m.exec(text);
  if (!match) return undefined;
  const value = match[1].replace(/^\$HOME(?=\/|$)/, home);
  return isAbsolute(value) ? value : undefined;
}

// The user's documents folder (XDG). Falls back to ~/Documents if it is unknown or disabled (equal to $HOME).
export function documentsDir({ home = homedir(), env = process.env } = {}) {
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
  let dir;
  try {
    dir = parseUserDirs(readFileSync(join(configHome, 'user-dirs.dirs'), 'utf8'), home);
  } catch {
    // no user-dirs.dirs: use the fallback
  }
  if (!dir || resolve(dir) === resolve(home)) dir = join(home, 'Documents');
  return dir;
}

export const defaultDocsDir = (options) => join(documentsDir(options), DOCS_FOLDER_NAME);
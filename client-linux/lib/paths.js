import { homedir } from 'node:os';
import { join } from 'node:path';

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

export const defaultDocsDir = () => join(homedir(), 'OpenRWP');
import { readFileSync } from 'node:fs';
import { ApiClient } from './api.js';
import { loadConfig } from './config.js';
import { ClientError } from './errors.js';
import { pathsIn } from './paths.js';

// Everything a command needs: paths, config and an API client for this device.
export function openContext(paths = pathsIn()) {
  const config = loadConfig(paths);
  if (!config) throw new ClientError('not-initialised', `no config.json in ${paths.dir}; run "openrwp init" first`);
  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(paths.deviceKey, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new ClientError('not-initialised', `device key ${paths.deviceKey} is missing; run "openrwp init"`);
    throw err;
  }
  return { paths, config, api: new ApiClient({ baseUrl: config.baseUrl, privateKeyPem }) };
}
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { createDpopProof, publicJwkFromPrivateKeyPem, jwkThumbprint } from '../index.js';

// Test helper for the DPoP flow (the Linux client will contain the same logic).
//   node core/bin/dpop.js keygen <key-file>                     create a Device key
//   node core/bin/dpop.js token <key-file> <token-url>          print a new access token
//   node core/bin/dpop.js proof <key-file> <METHOD> <url> [accessToken]   print a DPoP proof
const [command, ...args] = process.argv.slice(2);

function usage() {
  console.error('Usage:\n  dpop.js keygen <key-file>\n  dpop.js token <key-file> <token-url>\n  dpop.js proof <key-file> <METHOD> <url> [accessToken]');
  process.exit(2);
}

if (command === 'keygen' && args.length === 1) {
  const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  try {
    writeFileSync(args[0], pem, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    console.error(`Cannot write ${args[0]}: ${err.message}`);
    process.exit(1);
  }
  const jwk = publicJwkFromPrivateKeyPem(pem);
  console.log(`device key written to: ${args[0]}`);
  console.log(`public key (x): ${jwk.x}`);
  console.log(`thumbprint (jkt): ${jwkThumbprint(jwk)}`);
} else if (command === 'proof' && (args.length === 3 || args.length === 4)) {
  const [keyFile, method, url, accessToken] = args;
  console.log(createDpopProof({ privateKeyPem: readFileSync(keyFile, 'utf8'), method, url, accessToken }));
} else if (command === 'token' && args.length === 2) {
  const [keyFile, tokenUrl] = args;
  const proof = createDpopProof({ privateKeyPem: readFileSync(keyFile, 'utf8'), method: 'POST', url: tokenUrl });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: proof },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`token request failed (${res.status}): ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(body.access_token);
} else {
  usage();
}
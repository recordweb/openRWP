#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { generateEd25519KeyPair } from '../index.js';

// Usage: node core/bin/keygen.js <private-key-file>
// Writes the private key (PKCS#8 PEM, mode 0600, never overwrites) and prints the public key.
const file = process.argv[2];
if (!file) {
  console.error('Usage: node core/bin/keygen.js <private-key-file>');
  process.exit(2);
}

const { privateKeyPem, publicKeyMultibase } = generateEd25519KeyPair();
try {
  writeFileSync(file, privateKeyPem, { mode: 0o600, flag: 'wx' });
} catch (err) {
  console.error(`Cannot write ${file}: ${err.message}`);
  process.exit(1);
}
console.log(`private key written to: ${file}`);
console.log(`publicKeyMultibase: ${publicKeyMultibase}`);
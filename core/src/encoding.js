import { CoreError } from './errors.js';

// Binding decision: every `content` value is Base64 (RFC 4648 section 4, with padding).
export function encodeBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

// Strict: the string must be exactly what encodeBase64 would produce, so that the
// string used for hashing and the stored bytes always map one-to-one.
export function decodeBase64Strict(text) {
  if (typeof text !== 'string') throw new CoreError('invalid-base64', 'not a string');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text) throw new CoreError('invalid-base64');
  return bytes;
}
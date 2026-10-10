import { createHash } from 'node:crypto';

// RWP 19.1: SHA-256 only. Output is bare lowercase hex, no prefix.
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
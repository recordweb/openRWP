import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Hex, isHash } from '../core/index.js';

// File store for the raw bytes of representations. Internal storage detail (not part of RWP):
// files are addressed by the SHA-256 of their bytes, which also deduplicates identical files.
export function createBlobStore(dir) {
  const pathFor = (fileHash) => join(dir, fileHash.slice(0, 2), fileHash);

  return {
    // Writes atomically (temporary file, then rename). Returns { fileHash, size }.
    async put(bytes) {
      const fileHash = sha256Hex(bytes);
      const target = pathFor(fileHash);
      try {
        await access(target);
      } catch {
        await mkdir(join(dir, fileHash.slice(0, 2)), { recursive: true });
        const tmp = `${target}.${randomUUID()}.tmp`;
        await writeFile(tmp, bytes, { flag: 'wx' });
        await rename(tmp, target);
      }
      return { fileHash, size: bytes.length };
    },

    // Returns a Buffer, or null if the file does not exist.
    async get(fileHash) {
      if (!isHash(fileHash)) return null;
      try {
        return await readFile(pathFor(fileHash));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
  };
}
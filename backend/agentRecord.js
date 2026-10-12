import { computeContentHash, computeVersionHash, encodeBase64 } from '../core/index.js';

// The AgentRecord of a person (RWP chapter 13). RWP defines no AgentRecord type; this demo stores a small
// JSON document { type, name, email } as the single representation of each version.
export function buildAgentVersion({ name, email, parents, now = new Date() }) {
  const bytes = Buffer.from(JSON.stringify({ type: 'person', name, email }), 'utf8');
  const representation = { format: 'application/json', content: encodeBase64(bytes), primary: true, role: 'source' };
  representation.contentHash = computeContentHash(representation);
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const version = { state: 'draft', parents, createdAt: stamp, modifiedAt: stamp, representations: [representation] };
  version.versionHash = computeVersionHash(version);
  return { version, bytes };
}
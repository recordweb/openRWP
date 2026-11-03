import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Bytes } from './hash.js';
import { concatBytes } from './bytes.js';
import { multibaseEncode, multibaseDecode } from './multibase.js';
import { sign, verify } from './keys.js';

// RWP 7.7: Data Integrity proof with the cryptosuite eddsa-jcs-2022.
// Signature input (observed on the RecordWeb root records, finding F-4):
//   sha256(JCS(proof without proofValue)) followed by sha256(JCS(document without proof))
// The proof value is the signature as multibase base58btc ('z' prefix).

export const CRYPTOSUITE = 'eddsa-jcs-2022';

export function withoutProof(document) {
  const { proof, ...rest } = document;
  return rest;
}

async function signingInput(document, proofConfig) {
  return concatBytes(
    await sha256Bytes(canonicalize(proofConfig)),
    await sha256Bytes(canonicalize(withoutProof(document))),
  );
}

export async function createProof(document, { privateKey, verificationMethod, created, proofPurpose = 'assertionMethod' }) {
  if (typeof verificationMethod !== 'string' || verificationMethod === '') throw new CoreError('invalid-proof', 'verificationMethod');
  if (typeof created !== 'string' || created === '') throw new CoreError('invalid-proof', 'created');
  const config = { type: 'DataIntegrityProof', cryptosuite: CRYPTOSUITE, created, verificationMethod, proofPurpose };
  const signature = await sign(privateKey, await signingInput(document, config));
  return { ...config, proofValue: multibaseEncode(signature) };
}

// Appends a new proof. Every proof is calculated over the document without any proof (RWP 7.7).
export async function addProof(document, options) {
  const proof = await createProof(document, options);
  return { ...document, proof: [...(document.proof ?? []), proof] };
}

// Returns true if the signature is valid, false if it is not. Malformed proofs throw.
export async function verifyProof(document, proof, publicKey) {
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) throw new CoreError('invalid-proof');
  if (proof.type !== 'DataIntegrityProof') throw new CoreError('invalid-proof', 'type');
  if (proof.cryptosuite !== CRYPTOSUITE) throw new CoreError('invalid-proof', 'cryptosuite');
  for (const key of ['created', 'verificationMethod', 'proofPurpose', 'proofValue']) {
    if (typeof proof[key] !== 'string' || proof[key] === '') throw new CoreError('invalid-proof', key);
  }
  const { proofValue, ...config } = proof;
  let signature;
  try {
    signature = multibaseDecode(proofValue);
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  return verify(publicKey, signature, await signingInput(document, config));
}

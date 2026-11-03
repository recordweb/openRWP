import { CoreError } from './errors.js';
import { canonicalize } from './canonical.js';
import { sha256Ref, isHashRef } from './hash.js';
import { addProof, verifyProof, withoutProof } from './proof.js';

// DID document versions (RWP chapter 3).

const CONTEXT = 'https://www.w3.org/ns/did/v1';
const ED25519_CONTEXT = 'https://w3id.org/security/suites/ed25519-2020/v1';
// RWP 3.3. verificationMethod and controller are not part of this hash (finding F-15); the proof covers them.
const HASH_FIELDS = ['id', 'recordEndpoint', 'service', 'created', 'updated', 'currentVersionHash', 'previousVersionHash', 'proof'];

export async function computeDidDocumentHash(doc) {
  const input = {};
  for (const field of HASH_FIELDS) if (doc[field] !== undefined) input[field] = doc[field];
  return sha256Ref(canonicalize(input));
}

export function verificationMethodFor(did, publicKeyMultibase, keyId = 'key-1') {
  return { id: `${did}#${keyId}`, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase };
}

// First version of a DID document. `verificationMethod` is an array and only belongs into the DID document of an AgentRecord (RWP 7.7).
export function buildDidDocument({
  id, recordEndpoint, created, updated = created, currentVersionHash, previousVersionHash, service, controller, verificationMethod,
}) {
  const doc = { '@context': verificationMethod ? [CONTEXT, ED25519_CONTEXT] : CONTEXT, id, recordEndpoint, created, updated };
  if (currentVersionHash !== undefined) doc.currentVersionHash = currentVersionHash;
  if (previousVersionHash !== undefined) doc.previousVersionHash = previousVersionHash;
  if (service !== undefined) doc.service = service;
  if (controller !== undefined) doc.controller = controller;
  if (verificationMethod !== undefined) doc.verificationMethod = verificationMethod;
  return doc;
}

// Successor of a DID document version (RWP 3.2): same id and created, new updated, link to the predecessor, no proof yet.
export async function nextDidDocument(previous, changes, updated) {
  return {
    ...withoutProof(previous),
    ...changes,
    id: previous.id,
    created: previous.created,
    updated,
    previousVersionHash: await computeDidDocumentHash(previous),
  };
}

// RWP 7.7: every DID document version carries at least one proof, created at `updated`.
export async function signDidDocument(doc, { privateKey, verificationMethod }) {
  return addProof(withoutProof(doc), { privateKey, verificationMethod, created: doc.updated });
}

// RWP 3.4: checks the link to the predecessor, the order in time and that at least one proof verifies.
// Throws a CoreError on failure, returns true otherwise.
export async function verifyDidDocumentVersion(doc, { predecessor, publicKey }) {
  if (predecessor === undefined) {
    if (doc.previousVersionHash !== undefined) throw new CoreError('previous-hash-mismatch', 'first version has a predecessor');
  } else {
    if (doc.previousVersionHash !== (await computeDidDocumentHash(predecessor))) throw new CoreError('previous-hash-mismatch');
    if (!(Date.parse(doc.updated) > Date.parse(predecessor.updated))) throw new CoreError('updated-not-later');
  }
  if (doc.currentVersionHash !== undefined && !isHashRef(doc.currentVersionHash)) throw new CoreError('invalid-hash', 'currentVersionHash');
  if (!Array.isArray(doc.proof) || doc.proof.length === 0) throw new CoreError('proof-missing');
  for (const proof of doc.proof) {
    if (await verifyProof(doc, proof, publicKey)) return true;
  }
  throw new CoreError('proof-invalid');
}

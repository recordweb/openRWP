import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDidDocument, nextDidDocument, signDidDocument, verifyDidDocumentVersion, computeDidDocumentHash,
  verificationMethodFor, generateKeyPair, exportPublicKeyMultibase, makeDid, sha256Ref,
} from '../index.js';

async function agent() {
  const { privateKey, publicKey } = await generateKeyPair();
  const did = makeDid('example', 'agent-1');
  const method = verificationMethodFor(did, await exportPublicKeyMultibase(publicKey));
  const signer = { privateKey, verificationMethod: method.id };
  const first = await signDidDocument(buildDidDocument({
    id: did, recordEndpoint: 'https://example.org/records/', created: '2026-11-03T14:00:00Z', controller: did, verificationMethod: [method],
  }), signer);
  return { did, method, signer, publicKey, first };
}

test('the first version of an agent DID document verifies', async () => {
  const { first, publicKey, method, did } = await agent();
  assert.equal(method.id, `${did}#key-1`);
  assert.equal(method.type, 'Ed25519VerificationKey2020');
  assert.equal(first.updated, first.created);
  assert.equal(first.proof.length, 1);
  assert.equal(first.proof[0].created, first.updated);
  assert.equal(await verifyDidDocumentVersion(first, { publicKey }), true);
});

test('finalising a version creates a linked successor', async () => {
  const { first, signer, publicKey } = await agent();
  const currentVersionHash = await sha256Ref('version');
  const draft = await nextDidDocument(first, { currentVersionHash }, '2026-11-03T14:05:00Z');
  assert.equal(draft.proof, undefined);
  assert.equal(draft.id, first.id);
  assert.equal(draft.created, first.created);
  assert.equal(draft.previousVersionHash, await computeDidDocumentHash(first));
  const second = await signDidDocument(draft, signer);
  assert.equal(await verifyDidDocumentVersion(second, { predecessor: first, publicKey }), true);
});

test('the hash of a DID document version covers the proof', async () => {
  const { first, signer } = await agent();
  const again = await signDidDocument(first, signer);
  assert.notEqual(await computeDidDocumentHash(first), await computeDidDocumentHash({ ...first, proof: undefined }));
  assert.equal(again.proof.length, 1);
});

test('tampering, wrong links and wrong order are detected', async () => {
  const { first, signer, publicKey } = await agent();
  const second = await signDidDocument(await nextDidDocument(first, { currentVersionHash: await sha256Ref('v') }, '2026-11-03T14:05:00Z'), signer);
  await assert.rejects(() => verifyDidDocumentVersion({ ...second, recordEndpoint: 'https://evil.example/' }, { predecessor: first, publicKey }), { code: 'proof-invalid' });
  const wrongLink = { ...second, previousVersionHash: await sha256Ref('other') };
  await assert.rejects(() => verifyDidDocumentVersion(wrongLink, { predecessor: first, publicKey }), { code: 'previous-hash-mismatch' });
  await assert.rejects(() => verifyDidDocumentVersion(second, { publicKey }), { code: 'previous-hash-mismatch' });
  const early = await signDidDocument(await nextDidDocument(first, {}, '2026-11-03T13:00:00Z'), signer);
  await assert.rejects(() => verifyDidDocumentVersion(early, { predecessor: first, publicKey }), { code: 'updated-not-later' });
  const { proof, ...unsigned } = first;
  await assert.rejects(() => verifyDidDocumentVersion(unsigned, { publicKey }), { code: 'proof-missing' });
  const other = await generateKeyPair();
  await assert.rejects(() => verifyDidDocumentVersion(first, { publicKey: other.publicKey }), { code: 'proof-invalid' });
});

test('a DID document without keys uses the plain DID context', () => {
  const doc = buildDidDocument({ id: makeDid('example', 'note-1'), recordEndpoint: 'https://example.org/records/', created: '2026-11-03T14:00:00Z' });
  assert.equal(doc['@context'], 'https://www.w3.org/ns/did/v1');
  assert.equal('verificationMethod' in doc, false);
});

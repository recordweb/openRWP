import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyProof, createProof, addProof, signVersion, importPublicKey, generateKeyPair, exportPublicKeyMultibase,
  createVersion, createRepresentation, validateVersion, withoutProof,
} from '../index.js';
import { rootSchema, rootAgent, ROOT_SIGNER_KEY } from './vectors.js';

test('the signatures of the root records verify (eddsa-jcs-2022)', async () => {
  const key = await importPublicKey(ROOT_SIGNER_KEY);
  for (const record of [rootSchema, rootAgent]) {
    const version = record.payload[0];
    assert.equal(await verifyProof(version, version.proof[0], key), true);
  }
});

test('a changed version no longer verifies', async () => {
  const key = await importPublicKey(ROOT_SIGNER_KEY);
  const version = structuredClone(rootAgent.payload[0]);
  version.modifiedAt = '2026-10-26T18:10:01Z';
  assert.equal(await verifyProof(version, version.proof[0], key), false);
});

test('a proof of another document does not verify', async () => {
  const key = await importPublicKey(ROOT_SIGNER_KEY);
  assert.equal(await verifyProof(rootAgent.payload[0], rootSchema.payload[0].proof[0], key), false);
});

test('a foreign key does not verify', async () => {
  const { publicKey } = await generateKeyPair();
  const version = rootAgent.payload[0];
  assert.equal(await verifyProof(version, version.proof[0], publicKey), false);
});

test('sign and verify a new version', async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const verificationMethod = 'did:rwp:example:agent-1#key-1';
  const rep = await createRepresentation({ format: 'text/markdown', content: '# Note' });
  const version = await createVersion({ state: 'finalized', createdAt: '2026-11-03T12:00:00Z', representations: [rep] });
  const signed = await signVersion(version, { privateKey, verificationMethod });
  assert.equal(signed.proof.length, 1);
  assert.equal(signed.proof[0].created, version.modifiedAt);
  assert.equal(signed.proof[0].proofPurpose, 'assertionMethod');
  assert.equal(signed.proof[0].cryptosuite, 'eddsa-jcs-2022');
  await validateVersion(signed);
  assert.equal(await verifyProof(signed, signed.proof[0], publicKey), true);
});

test('several proofs are independent of each other', async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const doc = { id: 'x', value: 1 };
  const once = await addProof(doc, { privateKey: a.privateKey, verificationMethod: 'a#key-1', created: '2026-11-03T12:00:00Z' });
  const twice = await addProof(once, { privateKey: b.privateKey, verificationMethod: 'b#key-1', created: '2026-11-03T12:00:00Z' });
  assert.equal(twice.proof.length, 2);
  assert.equal(await verifyProof(twice, twice.proof[0], a.publicKey), true);
  assert.equal(await verifyProof(twice, twice.proof[1], b.publicKey), true);
  assert.deepEqual(withoutProof(twice), doc);
});

test('malformed proofs throw, broken signatures do not verify', async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const doc = { id: 'x' };
  const proof = await createProof(doc, { privateKey, verificationMethod: 'a#key-1', created: '2026-11-03T12:00:00Z' });
  await assert.rejects(() => verifyProof(doc, { ...proof, type: 'Other' }, publicKey), { code: 'invalid-proof' });
  await assert.rejects(() => verifyProof(doc, { ...proof, cryptosuite: 'other' }, publicKey), { code: 'invalid-proof' });
  await assert.rejects(() => verifyProof(doc, { ...proof, proofValue: undefined }, publicKey), { code: 'invalid-proof' });
  assert.equal(await verifyProof(doc, { ...proof, proofValue: 'z11' }, publicKey), false);
  assert.equal(await verifyProof(doc, { ...proof, proofValue: 'not multibase' }, publicKey), false);
  assert.match(await exportPublicKeyMultibase(publicKey), /^z6Mk/);
});

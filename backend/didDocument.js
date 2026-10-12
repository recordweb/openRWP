// Builds the DID document of a Record (RWP 4.3). Generated on request, not stored.
// currentVersion is the hash of the current FINALISED version and empty for a pure draft
// (RWP 4.3); this version only creates drafts, so it is always empty. `updated` equals `created`
// because the storage location does not change.
export function buildDidDocument({ did, publicBaseUrl, namespace, record, controller }) {
  const [, , ns, rec] = did.split(':');
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    recordEndpoint: `${publicBaseUrl}/records/${ns}/${rec}`,
    created: record.createdAt,
    updated: record.createdAt,
    currentVersion: '',
    controller,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller,
        publicKeyMultibase: namespace.authorPublicKey,
      },
    ],
  };
}
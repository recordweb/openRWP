// Builds the DID document of a Record (RWP 4.3). Generated on request, not stored.
export function buildDidDocument({ did, publicBaseUrl, namespace, record, currentVersion }) {
  const [, , ns, rec] = did.split(':');
  const doc = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    recordEndpoint: `${publicBaseUrl}/records/${ns}/${rec}`,
    created: record.createdAt,
    updated: record.updatedAt,
  };
  if (currentVersion) doc.currentVersion = currentVersion;
  // Open point in RWP 4.3: who is the controller. For now the Record DID itself.
  doc.controller = did;
  doc.verificationMethod = [
    {
      id: `${did}#key-1`,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: namespace.authorPublicKey,
    },
  ];
  return doc;
}
// OpenAPI 3.0 description of the OpenRWP custodian API (served at /api-docs).
// Keep in sync with the routes in app.js and links.js (docs.test.js checks the route list).

const hash = { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Bare lowercase hex SHA-256 (no prefix).' };

const schemas = {
  Hash: hash,
  Representation: {
    type: 'object',
    required: ['format', 'content', 'contentHash', 'primary'],
    additionalProperties: false,
    properties: {
      format: { type: 'string', example: 'application/vnd.oasis.opendocument.text' },
      content: { type: 'string', description: 'File content, Base64 (RFC 4648 section 4, with padding).' },
      contentHash: { ...hash, description: 'SHA-256 over JCS({format, content, primary, role}) (RWP 7.4).' },
      primary: { type: 'boolean', description: 'Exactly one representation per version is primary.' },
      role: { type: 'string', example: 'source' },
    },
  },
  Version: {
    type: 'object',
    required: ['versionHash', 'state', 'parents', 'createdAt', 'modifiedAt', 'representations'],
    additionalProperties: false,
    properties: {
      versionHash: { ...hash, description: 'SHA-256 over JCS({state, parents, createdAt, modifiedAt, representations}) (RWP 7.3).' },
      state: { type: 'string', enum: ['draft'], description: 'Version 1 accepts drafts only.' },
      parents: { type: 'array', items: { $ref: '#/components/schemas/Hash' }, description: 'Empty for the root version.' },
      createdAt: { type: 'string', example: '2026-10-10T14:39:45Z' },
      modifiedAt: { type: 'string', example: '2026-10-10T14:39:45Z' },
      representations: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/Representation' } },
      signature: { type: 'string', description: 'Optional in this version, not verified.' },
    },
  },
  RepresentationMeta: {
    type: 'object',
    properties: {
      format: { type: 'string' },
      contentHash: { $ref: '#/components/schemas/Hash' },
      primary: { type: 'boolean' },
      role: { type: 'string' },
    },
  },
  VersionMeta: {
    type: 'object',
    description: 'A version without file content.',
    properties: {
      versionHash: { $ref: '#/components/schemas/Hash' },
      state: { type: 'string' },
      parents: { type: 'array', items: { $ref: '#/components/schemas/Hash' } },
      createdAt: { type: 'string' },
      modifiedAt: { type: 'string' },
      representations: { type: 'array', items: { $ref: '#/components/schemas/RepresentationMeta' } },
      signature: { type: 'string' },
    },
  },
  Head: {
    type: 'object',
    properties: { versionHash: { $ref: '#/components/schemas/Hash' }, state: { type: 'string' } },
  },
  SyncRequest: {
    type: 'object',
    required: ['have'],
    properties: { have: { type: 'array', items: { $ref: '#/components/schemas/Hash' }, description: 'Heads known to the client; unknown hashes are ignored.' } },
  },
  SyncResponse: {
    type: 'object',
    properties: {
      versions: { type: 'array', items: { $ref: '#/components/schemas/VersionMeta' }, description: 'Parents before children.' },
      heads: { type: 'array', items: { $ref: '#/components/schemas/Head' }, description: 'All current heads, never filtered.' },
    },
  },
  AppendResult: {
    type: 'object',
    properties: {
      did: { type: 'string', example: 'did:rwp:4d3c45e8-1785-4f52-90f7-b9f5811935ad:28b91a20-f7cd-456b-a290-5d7088fdba74' },
      versionHash: { $ref: '#/components/schemas/Hash' },
      recordEndpoint: { type: 'string', format: 'uri' },
    },
  },
  SettingsEntry: {
    type: 'object',
    required: ['agent', 'modes'],
    additionalProperties: false,
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Present for existing links; omit to create a new link.' },
      agent: { type: 'string', enum: ['link'] },
      modes: { type: 'array', items: { type: 'string', enum: ['read'] }, minItems: 1, maxItems: 1 },
      scope: { type: 'string', enum: ['record'] },
      expires: { type: 'string', format: 'date-time', description: 'Default 7 days, at most 30 days from now.' },
      url: { type: 'string', format: 'uri', readOnly: true, description: 'Capability URL, returned only once when the link is created.' },
    },
  },
  Settings: {
    type: 'object',
    properties: {
      access: { type: 'array', items: { $ref: '#/components/schemas/SettingsEntry' } },
      views: { type: 'array', maxItems: 0, items: {} },
    },
  },
  CapabilityOverview: {
    type: 'object',
    properties: {
      did: { type: 'string' },
      versions: { type: 'array', items: { $ref: '#/components/schemas/VersionMeta' } },
      heads: { type: 'array', items: { $ref: '#/components/schemas/Head' } },
    },
  },
  DidDocument: {
    type: 'object',
    description: 'DID document of a Record (RWP 4.3), media type application/did+ld+json.',
    properties: {
      '@context': { type: 'array', items: { type: 'string' } },
      id: { type: 'string' },
      recordEndpoint: { type: 'string', format: 'uri' },
      created: { type: 'string' },
      updated: { type: 'string' },
      currentVersion: { $ref: '#/components/schemas/Hash' },
      controller: { type: 'string' },
      verificationMethod: { type: 'array', items: { type: 'object' } },
    },
  },
  TokenResponse: {
    type: 'object',
    properties: {
      access_token: { type: 'string' },
      token_type: { type: 'string', enum: ['DPoP'] },
      expires_in: { type: 'integer', example: 600 },
    },
  },
  OAuthError: {
    type: 'object',
    properties: { error: { type: 'string', example: 'invalid_dpop_proof' }, error_description: { type: 'string' } },
  },
  Error: {
    type: 'object',
    properties: { error: { type: 'string', example: 'unknown-parent' }, detail: { type: 'string' }, versionHash: { $ref: '#/components/schemas/Hash' } },
  },
};

const pathParam = (name, description, schema = { type: 'string' }) => ({
  name, in: 'path', required: true, description, schema,
});
const parameters = {
  Namespace: pathParam('ns', 'Namespace (UUIDv4); must be the namespace of the authenticated device.', { type: 'string', format: 'uuid' }),
  RecordId: pathParam('rec', 'Record identifier (UUIDv4).', { type: 'string', format: 'uuid' }),
  VersionHash: pathParam('hash', 'versionHash.', { $ref: '#/components/schemas/Hash' }),
  CapabilityToken: pathParam('token', 'Capability token (43 characters, base64url).'),
  DpopProof: {
    name: 'DPoP', in: 'header', required: true, schema: { type: 'string' },
    description: 'DPoP proof (RFC 9449) for this request: method, URL and access token hash. A fresh proof is needed for every request, so "Try it out" works only for public routes.',
  },
};

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const errorResponse = (description, schema = 'Error') => ({ description, content: json(ref(schema)) });
const record = [
  { $ref: '#/components/parameters/Namespace' },
  { $ref: '#/components/parameters/RecordId' },
  { $ref: '#/components/parameters/DpopProof' },
];
const secured = [{ dpop: [] }];
const authErrors = {
  401: { description: 'Missing or invalid DPoP token or proof (WWW-Authenticate: DPoP ...).', content: json(ref('Error')) },
  403: errorResponse('The device does not belong to this namespace.'),
};
const binary = { description: 'File content', content: { '*/*': { schema: { type: 'string', format: 'binary' } } } };

export function buildOpenApi(publicBaseUrl = '') {
  return {
    openapi: '3.0.3',
    info: {
      title: 'OpenRWP custodian API',
      version: '0.0.1',
      description:
        'Demo implementation of the RWP Client-Custodian Binding (draft 0.0.1) against RWP 0.0.8.\n\n' +
        'Protected routes need `Authorization: DPoP <access token>` and a `DPoP` proof header. ' +
        'Tokens are issued by `POST /token`. Third parties use capability URLs under `/c/{token}`.',
    },
    servers: [{ url: publicBaseUrl || '/' }],
    tags: [
      { name: 'Public' }, { name: 'Authentication' }, { name: 'Records' },
      { name: 'Settings' }, { name: 'Capability URLs' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Public'], summary: 'Health check',
          responses: { 200: { description: 'Service and database are up', content: json({ type: 'object' }) }, 503: { description: 'Database unavailable' } },
        },
      },
      '/did/{did}': {
        get: {
          tags: ['Public'], summary: 'Resolve a Record DID (RWP 4.4)',
          description: 'Public. Trailing hash segments of the DID are ignored.',
          parameters: [pathParam('did', 'did:rwp:<namespace>:<record-id>[:<versionHash>[:<contentHash>]]')],
          responses: {
            200: { description: 'DID document', content: { 'application/did+ld+json': { schema: ref('DidDocument') } } },
            400: errorResponse('Malformed DID'),
            404: errorResponse('Unknown DID'),
          },
        },
      },
      '/token': {
        post: {
          tags: ['Authentication'], summary: 'Obtain a DPoP-bound access token',
          description: 'grant_type=client_credentials. The device authenticates with its registered Device key through the DPoP proof.',
          parameters: [{ $ref: '#/components/parameters/DpopProof' }],
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['grant_type'], properties: { grant_type: { type: 'string', enum: ['client_credentials'] } } } } },
          },
          responses: {
            200: { description: 'Access token (valid 10 minutes)', content: json(ref('TokenResponse')) },
            400: errorResponse('invalid_request, unsupported_grant_type or invalid_dpop_proof', 'OAuthError'),
            401: errorResponse('invalid_client: unknown or revoked device', 'OAuthError'),
          },
        },
      },
      '/records/{ns}/{rec}/versions': {
        post: {
          tags: ['Records'], summary: 'Append one version (Binding 6.2)',
          description: 'Creates the record with the first (root) version. Identical repeats return 200.',
          security: secured, parameters: record,
          requestBody: { required: true, content: json(ref('Version')) },
          responses: {
            201: { description: 'Accepted', content: json(ref('AppendResult')) },
            200: { description: 'Identical version already present', content: json(ref('AppendResult')) },
            400: errorResponse('Malformed request'),
            ...authErrors,
            409: errorResponse('unknown-parent or root-exists'),
            413: errorResponse('Payload too large'),
            422: errorResponse('Hash mismatch, cycle, unsupported state or reference'),
          },
        },
      },
      '/records/{ns}/{rec}/versions/{hash}': {
        get: {
          tags: ['Records'], summary: 'Retrieve a version with inline content',
          security: secured, parameters: [...record, { $ref: '#/components/parameters/VersionHash' }],
          responses: { 200: { description: 'Version', content: json(ref('Version')) }, 400: errorResponse('Invalid hash'), ...authErrors, 404: errorResponse('Unknown version') },
        },
      },
      '/records/{ns}/{rec}/versions/{hash}/content': {
        get: {
          tags: ['Records'], summary: 'Retrieve the raw file of the primary representation',
          security: secured, parameters: [...record, { $ref: '#/components/parameters/VersionHash' }],
          responses: { 200: binary, 400: errorResponse('Invalid hash'), ...authErrors, 404: errorResponse('Unknown version') },
        },
      },
      '/records/{ns}/{rec}/sync': {
        post: {
          tags: ['Records'], summary: 'Synchronise (Binding 6.3)',
          description: 'Returns all versions not reachable from the given heads (metadata only) and all current heads.',
          security: secured, parameters: record,
          requestBody: { required: true, content: json(ref('SyncRequest')) },
          responses: { 200: { description: 'Missing versions and heads', content: json(ref('SyncResponse')) }, 400: errorResponse('Invalid request'), ...authErrors, 404: errorResponse('Unknown record') },
        },
      },
      '/records/{ns}/{rec}/settings': {
        get: {
          tags: ['Settings'], summary: 'Read the settings of a record (Binding 6.6)',
          security: secured, parameters: record,
          responses: { 200: { description: 'Settings (links without their secret)', content: json(ref('Settings')) }, ...authErrors, 404: errorResponse('Unknown record') },
        },
        put: {
          tags: ['Settings'], summary: 'Replace the list of capability links',
          description: 'Entries without id create a link and return its url once. Entries with a known id are kept (expiry may change). Links missing from the list are revoked.',
          security: secured, parameters: record,
          requestBody: { required: true, content: json(ref('Settings')) },
          responses: {
            200: { description: 'New settings; new entries carry the url', content: json(ref('Settings')) },
            400: errorResponse('Malformed request'),
            ...authErrors,
            404: errorResponse('Unknown record or link'),
            422: errorResponse('Unsupported agent, mode, scope or views, or invalid expiry'),
          },
        },
      },
      '/c/{token}': {
        get: {
          tags: ['Capability URLs'], summary: 'Overview of the record behind a capability URL',
          description: 'No authentication. Unknown, expired and revoked links all answer 404.',
          parameters: [{ $ref: '#/components/parameters/CapabilityToken' }],
          responses: { 200: { description: 'Versions (metadata) and heads', content: json(ref('CapabilityOverview')) }, 404: errorResponse('Not found') },
        },
      },
      '/c/{token}/versions/{hash}': {
        get: {
          tags: ['Capability URLs'], summary: 'Retrieve a version through a capability URL',
          parameters: [{ $ref: '#/components/parameters/CapabilityToken' }, { $ref: '#/components/parameters/VersionHash' }],
          responses: { 200: { description: 'Version', content: json(ref('Version')) }, 404: errorResponse('Not found') },
        },
      },
      '/c/{token}/versions/{hash}/content': {
        get: {
          tags: ['Capability URLs'], summary: 'Retrieve the raw file through a capability URL',
          parameters: [{ $ref: '#/components/parameters/CapabilityToken' }, { $ref: '#/components/parameters/VersionHash' }],
          responses: { 200: binary, 404: errorResponse('Not found') },
        },
      },
    },
    components: {
      schemas,
      parameters,
      securitySchemes: {
        dpop: {
          type: 'apiKey', in: 'header', name: 'Authorization',
          description: 'Value: `DPoP <access token>`. Every request also needs a `DPoP` proof header (RFC 9449).',
        },
      },
    },
  };
}
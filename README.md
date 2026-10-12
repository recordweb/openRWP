# OpenRWP

Demo implementation of the **RWP Client-Custodian Binding** (draft 0.0.1) on top of the
[RecordWeb Protocol](https://recordweb.github.io/rwp/) (RWP 0.0.8). It is a simple demo, not production quality.

The demo shows: a person saves a document (`.odt`) as a Record, sees its versions as a graph, and opens the
document on a phone through a capability URL.

| Component | Directory | Status |
|---|---|---|
| Custodian server with DID resolver, OAuth/DPoP token service | `backend/` | working, deployed |
| Shared core library (hashes, canonical JSON, graph, DPoP, keys) | `core/` | working |
| Linux client (Node.js CLI) | `client-linux/` | working, see `client-linux/README.md` |
| Android client | `client-android/` | open (purpose and timing not decided; capability links already work in any browser) |

Live instance: `https://vps.recordweb.dev/openrwp` (API documentation at `/openrwp/api-docs`).

## Concepts

- **Namespace** (UUIDv4): one account on the custodian, like a mailbox at a mail provider. Registered by an administrator.
- **Record**: identified by `did:rwp:<namespace>:<record-id>`. Created by its first (root) version.
- **Version**: an immutable node in the version graph (DAG). Identified by `versionHash`, linked by `parents`.
  Hashes are bare lowercase hex SHA-256 (no `sha256:` prefix).
- **Representation**: one form of the content of a version. Files are sent inline as Base64 (`content`) with a `contentHash`.
- **Device**: one installation of a client with its own Ed25519 key. Only registered devices get access tokens.
- **Capability URL**: `https://<host>/openrwp/c/<token>`, read-only access for third parties, revocable, expires.

## Repository layout

```bash
backend/ custodian server (Node.js, ES modules, PostgreSQL, no web framework)
  app.js routing, DPoP authentication
  token.js OAuth 2.0 token endpoint (client_credentials + DPoP)
  links.js settings and capability URLs
  versionReader.js shared read side (versions, content, sync)
  store.js db.js all SQL, migrations (schema "openrwp")
  blobs.js file store for the raw content
  openapi.js docs.js API documentation (Swagger UI at /api-docs)
  test/ node:test suites with an in-memory store
core/ shared library without dependencies, used by server and clients
  bin/ keygen.js, dpop.js, make-version.js (helper tools)
client-linux/ Linux client (Node.js CLI, no dependencies)
  bin/openrwp.js lib/ test/ testlib/
docs/ project report and change list (German)
.github/workflows/ deployment
```

## Storage

Metadata, version graph, devices and settings are stored in PostgreSQL (own schema `openrwp`, tables are only
touched by this application). The raw files are stored in a Docker volume, addressed by the SHA-256 of the file.
When a version is retrieved the file is returned inline in `content`, so the stored form does not matter for the
structure that RWP defines.

## Authentication

1. A device key pair (Ed25519) is created with `node core/bin/dpop.js keygen <file>`. The printed public key `x` is
   registered by the administrator (`admin/register-device.js`).
2. The device requests a token: `POST /token` with `grant_type=client_credentials` and a DPoP proof signed with the
   Device key. The server identifies the device by the key thumbprint. Tokens are opaque, bound to the key, valid 10 minutes.
3. Every request to a protected route carries `Authorization: DPoP <token>` and a fresh `DPoP` proof for that request
   (method, URL, token hash, unique `jti`, time window of 60 seconds). Used proofs are rejected (replay protection).
4. A single device can be revoked without touching the namespace.

```bash
export B=https://vps.recordweb.dev/openrwp
AT=$(node core/bin/dpop.js token ~/.openrwp/device.pem $B/token)
URL=$B/records/<namespace>/<record>/sync
curl -s -X POST -H "Authorization: DPoP $AT" -H "DPoP: $(node core/bin/dpop.js proof ~/.openrwp/device.pem POST $URL $AT)"
-H "Content-Type: application/json" -d '{"have":[]}' $URL
```

## API overview

| Route | Purpose | Access |
|---|---|---|
| `GET /health` | health check | public |
| `GET /did/{did}` | DID resolver (RWP 4.4) | public |
| `POST /token` | access token | registered device |
| `POST /records/{ns}/{rec}/versions` | append one version, creates the record | DPoP |
| `GET /records/{ns}/{rec}/versions/{hash}` | version with inline content | DPoP |
| `GET /records/{ns}/{rec}/versions/{hash}/content` | raw file | DPoP |
| `POST /records/{ns}/{rec}/sync` | missing versions (metadata) and all heads | DPoP |
| `GET/PUT /records/{ns}/{rec}/settings` | capability links | DPoP |
| `GET /c/{token}`, `/c/{token}/versions/{hash}[/content]` | read-only access | capability URL |

Details and schemas: `/openrwp/api-docs`.

## Deployment

A push to `main` runs `.github/workflows/deploy.yml`: it updates `/opt/openrwp` on the VPS, builds the Docker image
and starts the container. The image build runs the test suites of `core` and `backend`; failing tests stop the
deployment. A health check at the end of the workflow confirms the new container.

One-time setup on the VPS:

1. Create `/opt/openrwp` owned by the deploy user and add the repository secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.
2. Copy `.env.example` to `.env` and fill in the values (the file is never committed). A changed `.env` needs
   `docker compose up -d --force-recreate`.
3. The container joins the Docker networks `tws-proxy` (reverse proxy) and `poc-fragestunde_poc_network` (PostgreSQL).
4. Add the location `/openrwp/` to the Nginx configuration (`proxy_pass http://openrwp:3000/;`, `client_max_body_size 30m;`)
   only after the container is running, otherwise Nginx cannot resolve the host name.

Administration: the admin page at `/openrwp/admin/` (HTTP Basic login) manages namespaces (label, status),
the AgentRecord of each namespace owner (name and email), devices (register, revoke) and lists the DIDs of the
records. It exists only when `ADMIN_USER` and `ADMIN_PASSWORD_HASH` are set in `.env`. Create the hash on a
machine with Node.js:

```bash
read -rs PASSWORD; export PASSWORD # at least 12 characters
node backend/tools/hash-password.js # prints the ADMIN_PASSWORD_HASH line for .env
unset PASSWORD
```

Twenty failed logins within ten minutes lock the admin area for ten minutes.


## Linux client

The CLI in `client-linux/` saves documents from one folder as Records, shows the version graph and creates
capability links. Details are in [client-linux/README.md](client-linux/README.md).

```bash
node client-linux/bin/openrwp.js init                 # keys, config, folder, access check
node client-linux/bin/openrwp.js push report.odt      # new version
node client-linux/bin/openrwp.js graph report.odt     # version graph
node client-linux/bin/openrwp.js settings report.odt --create --days 3
```


## Tests

```bash
cd core && npm test
cd backend && npm test
cd client-linux && npm test  # Not in docker-build, must be run manually
```

## Scope of version 1 (deliberate deviations from the Binding and RWP)

- Only draft versions. Finalisation (Binding 6.5), PDF/A conversion and merge versions are not implemented.
- Representations with `ref` are rejected. Only `content` is supported.
- Version signatures are optional and not verified (open design question).
- Capability links: scope `record`, mode `read` only. `views` and other agents in settings are rejected.
- Namespaces and devices are registered by an administrator. The Global Namespace Registry is not queried.
- Only EdDSA (Ed25519) for DPoP proofs.
- Files are handled in memory (limit 25 MB per request).
- The Swagger UI loads its assets from a CDN.
- Linux client: flat document folder (`<Documents>/openRWP`), one file is one Record (the file name is the key),
  one head only (a second head stops `push` and `pull`), `createdAt` equals `modifiedAt`, requests are limited to
  25 MB and checked before sending.
- No SchemaRecord and no `service` entries in the DID documents (RWP CfC8, pull request 36). `recordType` stays a
  placeholder DID.
- The Android client is open. Capability links can be opened in any browser.

See `docs/aenderungsliste.md` for the points that should change in RWP, RWC and the Binding.
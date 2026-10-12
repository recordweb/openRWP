import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { verifyDpopProof } from '../../core/index.js';

const PREFIX = '/openrwp';

// Minimal custodian for client tests: real DPoP checks (htm, htu, ath, jti replay), tokens bound to the key.
// Set `fake.handler` to answer protected routes: ({ method, path, json, headers }) => { status, json | buffer }.
export async function startFakeServer({ devices = null, expiresIn = 600 } = {}) {
  const fake = {
    log: [],
    tokenRequests: 0,
    tokens: new Map(),
    used: new Set(),
    denyAuth: false,
    devices,
    handler: () => ({ status: 404, json: { error: 'not-found' } }),
    expireTokens() {
      this.tokens.clear();
    },
  };
  let origin = '';

  const reply = (res, { status = 200, json, buffer, headers = {} }) => {
    if (buffer !== undefined) {
      res.writeHead(status, { 'Content-Type': 'application/octet-stream', ...headers });
      res.end(buffer);
    } else {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(json === undefined ? '' : JSON.stringify(json));
    }
  };

  const checkProof = (req, url, accessToken) => {
    const { jkt, jti } = verifyDpopProof(req.headers.dpop, { method: req.method, url, accessToken });
    const key = `${jkt}:${jti}`;
    if (fake.used.has(key)) throw new Error('replay');
    fake.used.add(key);
    return jkt;
  };

  const deny = {
    status: 401,
    headers: { 'WWW-Authenticate': 'DPoP error="invalid_token"' },
    json: { error: 'invalid_token' },
  };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = `${origin}${req.url}`;
    const path = req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length) : null;
    fake.log.push(`${req.method} ${path}`);
    if (path === null) return reply(res, { status: 404, json: { error: 'not-found' } });

    try {
      if (req.method === 'POST' && path === '/token') {
        fake.tokenRequests += 1;
        let jkt;
        try {
          jkt = checkProof(req, url);
        } catch {
          return reply(res, { status: 400, json: { error: 'invalid_dpop_proof' } });
        }
        if (fake.devices && !fake.devices.has(jkt)) return reply(res, { status: 401, json: { error: 'invalid_client' } });
        if (raw.toString() !== 'grant_type=client_credentials') {
          return reply(res, { status: 400, json: { error: 'invalid_request' } });
        }
        const token = randomBytes(24).toString('base64url');
        fake.tokens.set(token, jkt);
        return reply(res, { json: { access_token: token, token_type: 'DPoP', expires_in: expiresIn } });
      }

      const auth = /^DPoP (\S+)$/.exec(req.headers.authorization ?? '');
      const tokenJkt = auth && !fake.denyAuth ? fake.tokens.get(auth[1]) : undefined;
      if (!tokenJkt) return reply(res, deny);
      let jkt;
      try {
        jkt = checkProof(req, url, auth[1]);
      } catch {
        return reply(res, deny);
      }
      if (jkt !== tokenJkt) return reply(res, deny);

      const json = raw.length > 0 && req.headers['content-type'] === 'application/json' ? JSON.parse(raw.toString()) : undefined;
      return reply(res, await fake.handler({ method: req.method, path, json, headers: req.headers }));
    } catch (err) {
      return reply(res, { status: 500, json: { error: 'fake-server-error', detail: err.message } });
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  fake.baseUrl = `${origin}${PREFIX}`;
  fake.close = () => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
  return fake;
}
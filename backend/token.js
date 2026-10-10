import { randomBytes } from 'node:crypto';
import { CoreError, verifyDpopProof, sha256Hex } from '../core/index.js';

// OAuth 2.0 token endpoint (grant_type=client_credentials) with DPoP (RFC 9449).
// The device authenticates by its registered key: the DPoP proof is signed with the Device key,
// the server looks the key up (thumbprint) and issues an opaque access token bound to that device.

const TOKEN_TTL_SECONDS = 600;
const JTI_TTL_SECONDS = 300; // longer than the accepted proof time window (2 x 60 s)

function reply(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

const oauthError = (res, status, error, description) =>
  reply(res, status, { error, ...(description ? { error_description: description } : {}) });

// Returns the body as text, or null if it exceeds maxBytes.
async function readSmallBody(req, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// `store` needs: getDeviceByJkt, recordDpopJti, createToken.
export function createTokenHandler({ store, config }) {
  return async function handleTokenRequest(req, res) {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (contentType !== 'application/x-www-form-urlencoded') {
      return oauthError(res, 400, 'invalid_request', 'content type must be application/x-www-form-urlencoded');
    }
    const body = await readSmallBody(req);
    if (body === null) return oauthError(res, 400, 'invalid_request', 'request too large');
    if (new URLSearchParams(body).get('grant_type') !== 'client_credentials') {
      return oauthError(res, 400, 'unsupported_grant_type');
    }

    let proof;
    try {
      proof = verifyDpopProof(req.headers.dpop, { method: 'POST', url: `${config.publicBaseUrl}/token` });
    } catch (err) {
      if (err instanceof CoreError) return oauthError(res, 400, 'invalid_dpop_proof', err.detail);
      throw err;
    }

    // Only registered devices may use up jti entries.
    const device = await store.getDeviceByJkt(proof.jkt);
    if (!device || device.revokedAt || device.namespaceStatus !== 'active') {
      return oauthError(res, 401, 'invalid_client');
    }
    if (!(await store.recordDpopJti(proof.jkt, proof.jti, JTI_TTL_SECONDS))) {
      return oauthError(res, 400, 'invalid_dpop_proof', 'jti already used');
    }

    const accessToken = randomBytes(32).toString('base64url');
    await store.createToken(device.id, sha256Hex(accessToken), TOKEN_TTL_SECONDS);
    reply(res, 200, { access_token: accessToken, token_type: 'DPoP', expires_in: TOKEN_TTL_SECONDS });
  };
}
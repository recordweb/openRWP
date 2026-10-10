// Shared HTTP helpers.
export const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
};
export const IMMUTABLE_PRIVATE = 'private, max-age=31536000, immutable';

export class HttpError extends Error {
  constructor(status, error, detail = '', extra = {}, headers = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...(detail ? { detail } : {}), ...extra };
    this.headers = headers;
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export async function readBody(req, maxBytes) {
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) throw new HttpError(413, 'payload-too-large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'payload-too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(req, maxBytes) {
  const raw = await readBody(req, maxBytes);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'malformed-json');
  }
}
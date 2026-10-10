import { HttpError, SECURITY_HEADERS, sendJson } from './http.js';
import { buildOpenApi } from './openapi.js';

// GET /api-docs        Swagger UI (assets from the swagger-ui-dist CDN)
// GET /api-docs/openapi.json
export function createDocsHandler({ config }) {
  const specUrl = `${config.publicBaseUrl}/api-docs/openapi.json`;
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenRWP API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: '#swagger-ui' });</script>
</body>
</html>
`;

  return function handleDocs(req, res, seg) {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed');
    if (seg.length === 2 && seg[1] === 'openapi.json') {
      return sendJson(res, 200, buildOpenApi(config.publicBaseUrl), { 'Cache-Control': 'no-cache' });
    }
    if (seg.length === 1) {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(page),
        'Cache-Control': 'no-cache',
      });
      return res.end(page);
    }
    throw new HttpError(404, 'not-found');
  };
}
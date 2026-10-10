import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'openrwp' }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not-found' }));
});

server.listen(PORT, () => console.log(`openrwp listening on ${PORT}`));
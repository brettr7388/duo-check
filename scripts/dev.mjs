// Local UI preview: serves public/ from disk, proxies /api/* to a deployed Duo Check.
// UPSTREAM=https://duo-check.<you>.workers.dev node scripts/dev.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const UP = process.env.UPSTREAM || 'https://duo-check.brettr7388.workers.dev';
const port = Number(process.argv[2] || 8787);
const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await fetch(UP + req.url, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const p = req.url === '/' ? 'index.html' : normalize(req.url.split('?')[0]).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
}).listen(port, () => console.log('dev on http://localhost:' + port));

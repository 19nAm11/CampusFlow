const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'main.css', 'study.css', 'script.js', 'sign_in.html', 'sign_in.js', 'sign_up.html', 'sign_up.js', 'supabase-config.js', 'favicon.svg']);
const types = {'.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.svg':'image/svg+xml'};
http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, {Allow: 'GET, HEAD'}); return res.end();
  }
  try {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!files.has(name)) { res.writeHead(404); return res.end('Not found'); }
    const body = await fs.readFile(path.join(root, name));
    res.writeHead(200, {'Content-Type': `${types[path.extname(name)]}; charset=utf-8`, 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500); res.end('Unable to serve file');
  }
}).listen(5500, '127.0.0.1', () => console.log('CampusFlow: http://localhost:5500'));

// Public guide preview only. Use npm run dev:worker to exercise the real Worker integration.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../public/', import.meta.url)).replace(/[\\/]$/, '');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const port = Number(option('--port', process.env.PORT || 4173));
const host = option('--host', process.env.HOST || '127.0.0.1');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png'
};
const settings = (await readFile(resolve(root, '_headers'), 'utf8'))
  .split('\n')
  .filter((s) => s.startsWith('  '))
  .map((s) =>
    s
      .trim()
      .split(/:(.*)/s)
      .slice(0, 2)
      .map((v) => v.trim())
  );
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local.invalid');
    if (url.pathname === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"enabled":false,"user":null}');
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const st = await stat(file).catch(() => null);
    const target = st?.isDirectory() ? resolve(file, 'index.html') : file;
    const bytes = await readFile(target).catch(() => null);
    const safe = bytes && Object.hasOwn(types, extname(target));
    res.writeHead(safe ? 200 : 404, {
      ...Object.fromEntries(settings),
      'Content-Type': safe ? types[extname(target)] : types['.html']
    });
    res.end(req.method === 'HEAD' ? '' : safe ? bytes : await readFile(resolve(root, '404.html')));
  } catch {
    res.writeHead(400);
    res.end('Invalid request');
  }
}).listen(port, host, () => console.log('HatchHaven preview on ' + host + ':' + port));

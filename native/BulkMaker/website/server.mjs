import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createCommerce, readCommerceConfig, CommerceError } from './commerce.mjs';
import { latestRelease } from './release-store.mjs';
import { renderSitePage } from './site-page.mjs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { createWaitlistStore } from './waitlist-store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, 'public');
try { loadEnvFile(resolve(root, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const store = await createWaitlistStore();
const commerce = createCommerce({ config: await readCommerceConfig() });
const releaseRoot = resolve(process.env.RELEASES_DIR || resolve(root, 'releases'));
async function page(path) {
  return Buffer.from(renderSitePage(await readFile(path, 'utf8'), commerce.config));
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === (process.env.SITE_ORIGIN ? new URL(process.env.SITE_ORIGIN).host : req.headers.host); }
  catch { return false; }
}
function rateLimit(req, category) {
  const key = `${category}:${req.socket.remoteAddress}`;
  const now = Date.now();
  let value = attempts.get(key);
  if (!value || value.expires < now) value = { count: 0, expires: now + 60000 };
  value.count++; attempts.set(key, value);
  return value.count > 10;
}
async function commerceRequest(req, res, pathname) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
  if (rateLimit(req, pathname)) return json(res, 429, { error: 'Espere um minuto e tente novamente.' }, { 'Retry-After': '60' });
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2048) return json(res, 413, { error: 'Pedido muito grande.' }); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  if (pathname === '/api/license/subscription') {
    let body; try { body = JSON.parse(text); } catch { return json(res, 400, { error: 'Pedido inválido.' }); }
    if (!body || Array.isArray(body)) return json(res, 400, { error: 'Pedido inválido.' });
    return json(res, 200, await commerce.subscription(body));
  }
  const url = await commerce.checkout(pathname.split('/').at(-1));
  if (req.headers.accept?.includes('application/json')) return json(res, 200, { url });
  res.writeHead(303, { Location: url, 'Cache-Control': 'no-store' }); res.end();
}
async function serveRelease(req, res, pathname) {
  const name = pathname === '/appcast.xml' ? 'appcast.xml' : decodeURIComponent(pathname.slice('/releases/'.length));
  if (name.includes('/') || name.includes('\\') || !(/\.(dmg|xml)$/.test(name))) return json(res, 404, { error: 'Arquivo não encontrado.' });
  const path = pathname === '/appcast.xml' ? resolve(releaseRoot, name) : resolve(releaseRoot, 'releases', name);
  let info; try { info = await stat(path); } catch { return json(res, 404, { error: 'Arquivo não encontrado.' }); }
  if (!info.isFile()) return json(res, 404, { error: 'Arquivo não encontrado.' });
  let start = 0, end = info.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!match) return json(res, 416, { error: 'Intervalo inválido.' }, { 'Content-Range': `bytes */${info.size}` });
    start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
    if (start > end || end >= info.size) return json(res, 416, { error: 'Intervalo inválido.' }, { 'Content-Range': `bytes */${info.size}` });
    status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  res.writeHead(status, { 'Content-Type': name.endsWith('.xml') ? 'application/rss+xml; charset=utf-8' : 'application/x-apple-diskimage',
    'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': name.endsWith('.xml') ? 'no-cache' : 'public, max-age=86400' });
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(path, { start, end }), res);
}
const mediaTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const attempts = new Map();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
}, 60000);
cleanup.unref();

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function saveSignup(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { /* invalid origin */ }
    const expectedHost = process.env.SITE_ORIGIN ? new URL(process.env.SITE_ORIGIN).host : req.headers.host;
    if (originHost !== expectedHost) return json(res, 403, { error: 'Origem não permitida.' });
  }
  const client = req.socket.remoteAddress;
  const now = Date.now();
  let rate = attempts.get(client);
  if (!rate || rate.expires < now) rate = { count: 0, expires: now + 60000 };
  rate.count++;
  attempts.set(client, rate);
  if (rate.count > 10) return json(res, 429, { error: 'Espere um minuto e tente de novo.' }, { 'Retry-After': '60' });

  const contentType = (req.headers['content-type'] || '').split(';')[0];
  if (!['application/json', 'application/x-www-form-urlencoded'].includes(contentType)) {
    return json(res, 415, { error: 'Formato não aceito.' });
  }
  if (Number(req.headers['content-length']) > 2048) return json(res, 413, { error: 'Pedido muito grande.' });
  let text = '';
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) return json(res, 413, { error: 'Pedido muito grande.' });
    text += chunk.toString('utf8');
  }
  let body;
  try {
    body = contentType === 'application/json' ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
  } catch { return json(res, 400, { error: 'Pedido inválido.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Pedido inválido.' });

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const xHandle = typeof body.xHandle === 'string' ? body.xHandle.trim().replace(/^@/, '') : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Confira seu email.', field: 'email' });
  }
  if (xHandle.length > 0 && !/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
    return json(res, 400, { error: 'Confira seu @ do X.', field: 'xHandle' });
  }
  await store.save(email, xHandle);
  if (contentType === 'application/x-www-form-urlencoded') {
    res.writeHead(303, { Location: '/thanks.html', 'Cache-Control': 'no-store' });
    res.end();
  } else json(res, 200, { ok: true });
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://*.lemonsqueezy.com");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/waitlist') return await saveSignup(req, res);
    if (url.pathname.startsWith('/checkout/') || url.pathname === '/api/license/subscription') return await commerceRequest(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'Método não permitido.' }, { Allow: 'GET, HEAD' });
    }
    if (url.pathname === '/api/releases/latest') {
      const release = await latestRelease(releaseRoot);
      return json(res, release ? 200 : 503, release || { error: 'A versão de distribuição ainda não foi publicada.' });
    }
    if (url.pathname === '/download/latest') {
      const release = await latestRelease(releaseRoot);
      if (!release) return json(res, 503, { error: 'A versão de distribuição ainda não foi publicada.' });
      res.writeHead(302, { Location: release.url, 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname.startsWith('/releases/') || url.pathname === '/appcast.xml') return await serveRelease(req, res, url.pathname);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'URL inválida.' }); }
    const aliases = { '/': '/index.html', '/download': '/download.html', '/termos': '/terms.html', '/privacidade': '/privacy.html', '/reembolso': '/refund.html' };
    const path = resolve(publicRoot, `.${aliases[pathname] || pathname}`);
    const notFound = async () => {
      const html = await page(resolve(publicRoot, '404.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : html);
    };
    if (!path.startsWith(publicRoot + sep) || !mediaTypes[extname(path)]) return await notFound();
    let file;
    try {
      if (!(await stat(path)).isFile()) return await notFound();
      file = extname(path) === '.html' ? await page(path) : await readFile(path);
    } catch (error) {
      if (error.code === 'ENOENT') return await notFound();
      throw error;
    }
    res.writeHead(200, {
      'Content-Type': mediaTypes[extname(path)], 'Content-Length': file.length,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : file);
  } catch (error) {
    console.error('Falha ao processar pedido:', error.code || error.name);
    if (!res.headersSent) json(res, error instanceof CommerceError ? error.status : 500, { error: error instanceof CommerceError ? error.message : 'Não foi possível concluir agora. Tente novamente.' });
    else res.end();
  }
});
server.requestTimeout = 15000;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`The Carousel Maker: http://${host}:${server.address().port} (cadastros: ${store.provider})`));
function close() {
  server.close(() => { store.close(); process.exit(0); });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);

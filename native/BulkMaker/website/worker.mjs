// Site de lista de espera no Cloudflare Worker. Compartilha as páginas e o renderizador com server.mjs.
// O checkout permanece implementado, sem links na interface pública. Assets vêm de ./public via ASSETS.
import config from './commerce.config.json' with { type: 'json' };
import { renderSitePage } from './site-page.mjs';
import { createCommerce, CommerceError } from './commerce.mjs';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://*.lemonsqueezy.com",
};
const ALIASES = { '/': '/index.html', '/download': '/download.html', '/termos': '/terms.html', '/privacidade': '/privacy.html', '/reembolso': '/refund.html' };
const NO_RELEASE = 'A versão de distribuição ainda não foi publicada.';
// Per isolate, like the Node server's map: enough to slow a burst, not a hard global limit.
const attempts = new Map();

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function withSecurity(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function sameOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const expected = env.SITE_ORIGIN ? new URL(env.SITE_ORIGIN).host : new URL(request.url).host;
    return new URL(origin).host === expected;
  } catch { return false; }
}

function rateLimited(request, category) {
  const key = `${category}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  const now = Date.now();
  let value = attempts.get(key);
  if (!value || value.expires < now) value = { count: 0, expires: now + 60000 };
  value.count++; attempts.set(key, value);
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.expires < now) attempts.delete(k);
  return value.count > 10;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 2048) throw new CommerceError('Pedido muito grande.', 413);
  return text;
}

async function saveSignup(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
  if (!sameOrigin(request, env)) return json(403, { error: 'Origem não permitida.' });
  if (rateLimited(request, 'waitlist')) return json(429, { error: 'Espere um minuto e tente de novo.' }, { 'Retry-After': '60' });
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!['application/json', 'application/x-www-form-urlencoded'].includes(contentType)) return json(415, { error: 'Formato não aceito.' });
  let body;
  try {
    const text = await readBody(request);
    body = contentType === 'application/json' ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
  } catch (error) {
    if (error instanceof CommerceError) return json(error.status, { error: error.message });
    return json(400, { error: 'Pedido inválido.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Pedido inválido.' });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const xHandle = typeof body.xHandle === 'string' ? body.xHandle.trim().replace(/^@/, '') : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Confira seu email.', field: 'email' });
  if (!/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) return json(400, { error: 'Confira seu @ do X.', field: 'xHandle' });

  const base = env.SUPABASE_URL, secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) return json(503, { error: 'A lista ainda não está aberta. Tente mais tarde.' });
  const endpoint = new URL('/rest/v1/carousel_waitlist', base);
  endpoint.searchParams.set('on_conflict', 'email');
  const headers = { apikey: secret, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' };
  // New sb_secret keys belong only in apikey. Legacy service_role keys are JWTs.
  if (!secret.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + secret;
  const response = await fetch(endpoint, {
    method: 'POST', headers, body: JSON.stringify({ email, x_handle: xHandle }), redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return json(500, { error: 'Não foi possível salvar. Tente de novo.' });
  if (contentType === 'application/x-www-form-urlencoded') return new Response(null, { status: 303, headers: { Location: '/thanks.html', 'Cache-Control': 'no-store' } });
  return json(200, { ok: true });
}

async function commerceRequest(request, env, commerce, pathname) {
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
  if (!sameOrigin(request, env)) return json(403, { error: 'Origem não permitida.' });
  if (rateLimited(request, pathname)) return json(429, { error: 'Espere um minuto e tente novamente.' }, { 'Retry-After': '60' });
  const text = await readBody(request);
  if (pathname === '/api/license/subscription') {
    let body; try { body = JSON.parse(text); } catch { return json(400, { error: 'Pedido inválido.' }); }
    if (!body || Array.isArray(body)) return json(400, { error: 'Pedido inválido.' });
    return json(200, await commerce.subscription(body));
  }
  const url = await commerce.checkout(pathname.split('/').at(-1));
  if (request.headers.get('Accept')?.includes('application/json')) return json(200, { url });
  return new Response(null, { status: 303, headers: { Location: url, 'Cache-Control': 'no-store' } });
}

async function serveFile(request, env, commerce, pathname) {
  const target = ALIASES[pathname] || pathname;
  const assetURL = new URL(target, request.url);
  let response = await env.ASSETS.fetch(new Request(assetURL, { method: 'GET' }));
  let status = 200;
  if (!response.ok || target.endsWith('/')) {
    response = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
    status = 404;
  }
  const type = response.headers.get('Content-Type') || '';
  const headers = new Headers(response.headers);
  let body = response.body;
  if (type.startsWith('text/html')) {
    body = renderSitePage(await response.text(), config);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', status === 404 ? 'no-store' : 'no-cache');
    headers.delete('Content-Length'); headers.delete('ETag');
  } else if (pathname.startsWith('/assets/')) {
    headers.set('Cache-Control', 'public, max-age=86400');
  }
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

export default {
  async fetch(request, env) {
    const commerce = createCommerce({ config, env });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/waitlist') return withSecurity(await saveSignup(request, env));
      if (url.pathname.startsWith('/checkout/') || url.pathname === '/api/license/subscription') {
        return withSecurity(await commerceRequest(request, env, commerce, url.pathname));
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return withSecurity(json(405, { error: 'Método não permitido.' }, { Allow: 'GET, HEAD' }));
      if (url.pathname === '/api/releases/latest' || url.pathname === '/download/latest') return withSecurity(json(503, { error: NO_RELEASE }));
      if (url.pathname.startsWith('/releases/') || url.pathname === '/appcast.xml') return withSecurity(json(404, { error: 'Arquivo não encontrado.' }));
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return withSecurity(json(400, { error: 'URL inválida.' })); }
      return withSecurity(await serveFile(request, env, commerce, pathname));
    } catch (error) {
      console.error('Falha ao processar pedido:', error.code || error.name);
      const status = error instanceof CommerceError ? error.status : 500;
      return withSecurity(json(status, { error: error instanceof CommerceError ? error.message : 'Não foi possível concluir agora. Tente novamente.' }));
    }
  },
};

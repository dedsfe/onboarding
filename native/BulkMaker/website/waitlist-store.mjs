import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export async function createWaitlistStore({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const supabaseURL = (env.SUPABASE_URL || '').trim();
  const secret = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (Boolean(supabaseURL) !== Boolean(secret)) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY juntos.');
  }
  if (supabaseURL) {
    let base;
    try { base = new URL(supabaseURL); }
    catch { throw new Error('SUPABASE_URL inválida.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && local))
        || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
      throw new Error('SUPABASE_URL deve ser a origem HTTPS do projeto.');
    }
    let legacy = false;
    if (!secret.startsWith('sb_secret_')) {
      try {
        const parts = secret.split('.');
        legacy = parts.length === 3
          && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role';
      } catch { /* invalid key */ }
      if (!legacy) throw new Error('Use uma chave secreta de backend do Supabase.');
    }
    const endpoint = new URL('/rest/v1/carousel_waitlist', base);
    endpoint.searchParams.set('on_conflict', 'email');
    const headers = {
      apikey: secret,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    };
    // New sb_secret keys belong only in apikey. Legacy service_role keys are JWTs.
    if (legacy) headers.Authorization = 'Bearer ' + secret;
    return {
      provider: 'supabase',
      async save(email, xHandle) {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, x_handle: xHandle }),
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const error = new Error('Não foi possível salvar no Supabase.');
          error.code = 'SUPABASE_WRITE_FAILED';
          throw error;
        }
      },
      close() {},
    };
  }

  const { DatabaseSync } = await import('node:sqlite');
  const dataRoot = resolve(env.DATA_DIR || resolve(root, 'data'));
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataRoot, 'waitlist.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS waitlist (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      x_handle TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  const insert = db.prepare('INSERT INTO waitlist (email, x_handle) VALUES (?, ?) ON CONFLICT(email) DO NOTHING');
  return {
    provider: 'sqlite',
    async save(email, xHandle) { insert.run(email, xHandle); },
    close() { db.close(); },
  };
}

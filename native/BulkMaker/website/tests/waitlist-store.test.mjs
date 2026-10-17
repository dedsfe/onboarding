import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWaitlistStore } from '../waitlist-store.mjs';

test('SQLite persists signups and duplicate email preserves the original handle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'carousel-waitlist-test-'));
  let store;
  try {
    store = await createWaitlistStore({ env: { DATA_DIR: dir } });
    await store.save('person@example.invalid', 'first_handle');
    await store.save('person@example.invalid', 'another_handle');
    await store.save('second@example.invalid', '');
    store.close();
    store = undefined;
    const { DatabaseSync } = await import('node:sqlite');
    const reader = new DatabaseSync(join(dir, 'waitlist.sqlite'), { readOnly: true });
    try {
      const rows = reader.prepare('SELECT email, x_handle FROM waitlist ORDER BY id').all();
      assert.equal(rows.length, 2);
      assert.equal(rows[0].x_handle, 'first_handle');
      assert.equal(rows[1].x_handle, '');
    } finally { reader.close(); }
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Supabase accepts insert and duplicate acknowledgement without disclosing data', async () => {
  const calls = [];
  const store = await createWaitlistStore({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_fixture' },
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(null, { status: calls.length === 1 ? 201 : 200 });
    },
  });
  await store.save('person@example.invalid', 'test_handle');
  await store.save('person@example.invalid', 'test_handle');
  assert.equal(store.provider, 'supabase');
  assert.equal(calls.length, 2);
  const { url, options } = calls[0];
  assert.equal(url.pathname, '/rest/v1/carousel_waitlist');
  assert.equal(url.searchParams.get('on_conflict'), 'email');
  assert.equal(options.headers.apikey, 'sb_secret_test_fixture');
  assert.equal(options.headers.Authorization, undefined);
  assert.match(options.headers.Prefer, /ignore-duplicates/);
  assert.deepEqual(JSON.parse(options.body), { email: 'person@example.invalid', x_handle: 'test_handle' });
});

test('Supabase errors never report a saved signup or fall back to local storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'carousel-waitlist-error-'));
  const unused = join(dir, 'not-created');
  try {
    const store = await createWaitlistStore({
      env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_fixture', DATA_DIR: unused },
      fetchImpl: async () => new Response(null, { status: 401 }),
    });
    await assert.rejects(store.save('person@example.invalid', 'test_handle'), { code: 'SUPABASE_WRITE_FAILED' });
    await assert.rejects(access(unused), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('partial config and public keys are rejected before serving signups', async () => {
  await assert.rejects(createWaitlistStore({ env: { SUPABASE_URL: 'https://example.supabase.co' } }));
  await assert.rejects(createWaitlistStore({ env: { SUPABASE_SECRET_KEY: 'sb_secret_test_fixture' } }));
  await assert.rejects(createWaitlistStore({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_publishable_test_fixture' },
  }));
});

test('legacy service_role JWT remains compatible', async () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const key = 'fixture.' + payload + '.fixture';
  let request;
  const store = await createWaitlistStore({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key },
    fetchImpl: async (_, options) => { request = options; return new Response(null, { status: 201 }); },
  });
  await store.save('person@example.invalid', 'test_handle');
  assert.equal(request.headers.Authorization, 'Bearer ' + key);
});

test('upstream network failures propagate instead of claiming success', async () => {
  const store = await createWaitlistStore({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test_fixture' },
    fetchImpl: async () => { throw new TypeError('network unavailable'); },
  });
  await assert.rejects(store.save('person@example.invalid', 'test_handle'), /network unavailable/);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertProductionSafe, getSupabase, __reset } = require('./supabase');

const KEYS = ['NODE_ENV', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
let snapshot = {};

test.beforeEach(() => { snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); __reset(); });
test.afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  __reset();
});

test('production without a service-role key refuses to start', () => {
  // Once RLS is on, the anon key reads nothing. Failing here beats discovering
  // it as "no accounts configured" halfway through a scheduled run.
  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.throws(() => assertProductionSafe(), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.throws(() => getSupabase(), /Refusing to start/);
});

test('production with a service-role key but no URL also refuses', () => {
  // The key alone still yields a null client, and the callers then fall back to
  // legacy environment credentials — the same failure by a different door.
  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  delete process.env.SUPABASE_URL;

  assert.throws(() => assertProductionSafe(), /SUPABASE_URL/);
  assert.throws(() => getSupabase(), /Refusing to start/);
});

test('production names every missing variable at once', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const err = (() => { try { assertProductionSafe(); } catch (e) { return e; } })();
  assert.match(err.message, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
});

test('production with both set is fine', () => {
  process.env.NODE_ENV = 'production';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  assert.doesNotThrow(() => assertProductionSafe());
});

test('outside production the anon key is still allowed', () => {
  process.env.NODE_ENV = 'development';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.doesNotThrow(() => assertProductionSafe());
});

test('no database configured at all is not a startup failure', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(getSupabase(), null);
});

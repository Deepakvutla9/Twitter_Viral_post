const test = require('node:test');
const assert = require('node:assert/strict');

// Stub axios before requiring the service so no test can reach the Graph API.
const axiosPath = require.resolve('axios');
let getHandler = async () => ({ data: {} });
let postHandler = async () => ({ data: { id: 'X' } });
let calls = [];
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: {
    get: async (url, cfg) => { calls.push(['get', url]); return getHandler(url, cfg); },
    post: async (url, body, cfg) => { calls.push(['post', url]); return postHandler(url, cfg); },
  },
};

const supa = require('./supabase');
const { postCarousel, checkToken, refreshToken } = require('./instagram');

const ACCOUNT = Object.freeze({ slug: 'shadesofirony', handle: '@shadesofirony', igUserId: '17841400000000000' });

function makeDb(initial = null, hooks = {}) {
  let row = initial ? { ...initial } : null;
  function builder() {
    const q = { _filters: {}, _op: null, _payload: null };
    q.select = () => {
      if (q._op !== 'update') { q._op = 'select'; return q; }
      if (hooks.beforeUpdate) hooks.beforeUpdate((next) => { row = next; });
      if (!row || q._filters.refreshed_at !== row.refreshed_at) return Promise.resolve({ data: [], error: null });
      row = { ...row, ...q._payload };
      return Promise.resolve({ data: [{ refreshed_at: row.refreshed_at }], error: null });
    };
    q.eq = (c, v) => { q._filters[c] = v; return q; };
    q.maybeSingle = async () => ({ data: row, error: null });
    q.update = (p) => { q._op = 'update'; q._payload = p; return q; };
    q.insert = async (p) => { if (row) return { error: { code: '23505', message: 'dup' } }; row = { ...p }; return { error: null }; };
    return q;
  }
  return { from: () => builder(), _row: () => row };
}

test.afterEach(() => {
  supa.__reset();
  calls = [];
  getHandler = async () => ({ data: {} });
  postHandler = async () => ({ data: { id: 'X' } });
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
});

test('every entry point refuses to act without an account', async () => {
  // The old signatures read credentials from process.env, so a forgotten
  // argument still posted -- to whichever account the environment named.
  await assert.rejects(() => postCarousel(['a.jpg'], 'caption'), /requires a normalized account/);
  await assert.rejects(() => refreshToken(), /requires a normalized account/);
  assert.equal(calls.length, 0, 'nothing should reach the network');
});

test('an account missing its ig id is refused too', async () => {
  await assert.rejects(
    () => postCarousel(['a.jpg'], 'c', { slug: 'shadesofirony' }),
    /requires a normalized account/,
  );
});

test('checkToken reports the handle it authenticated as', async () => {
  supa.__setClient(makeDb({ account_slug: 'shadesofirony', token: 'T1', refreshed_at: 'v1' }));
  getHandler = async () => ({ data: { id: '1', username: 'shadesofirony', account_type: 'MEDIA_CREATOR' } });
  const out = await checkToken(ACCOUNT);
  assert.equal(out.ok, true);
  assert.equal(out.username, 'shadesofirony');
  assert.equal(out.slug, 'shadesofirony');
});

test('checkToken answers rather than throwing when the account has no token', async () => {
  supa.__setClient(makeDb(null));
  const out = await checkToken(ACCOUNT);
  assert.equal(out.ok, false);
  assert.match(out.error, /not found in ig_tokens/);
});

test('an expired token names the account in the error', async () => {
  supa.__setClient(makeDb({ account_slug: 'shadesofirony', token: 'DEAD', refreshed_at: 'v1' }));
  getHandler = async () => {
    const e = new Error('req failed');
    e.response = { data: { error: { code: 190, message: 'Session has been invalidated' } } };
    throw e;
  };
  const out = await checkToken(ACCOUNT);
  assert.equal(out.ok, false);
  assert.match(out.error, /@shadesofirony/);
  assert.match(out.error, /shadesofirony/);
});

test('a successful refresh stores the new token', async () => {
  const db = makeDb({ account_slug: 'shadesofirony', token: 'OLD', refreshed_at: 'v1' });
  supa.__setClient(db);
  getHandler = async () => ({ data: { access_token: 'NEW', expires_in: 5184000 } });

  const out = await refreshToken(ACCOUNT);
  assert.equal(out.ok, true);
  assert.equal(out.won, true);
  assert.equal(out.token, 'NEW');
  assert.equal(db._row().token, 'NEW');
  assert.equal(out.days, 60);
});

test('a refresh that loses the race returns the live token, not its own', async () => {
  const db = makeDb(
    { account_slug: 'shadesofirony', token: 'OLD', refreshed_at: 'v1' },
    { beforeUpdate: (setRow) => setRow({ account_slug: 'shadesofirony', token: 'WINNER', refreshed_at: 'v2' }) },
  );
  supa.__setClient(db);
  getHandler = async () => ({ data: { access_token: 'MINE', expires_in: 5184000 } });

  const out = await refreshToken(ACCOUNT);

  assert.equal(out.ok, true);
  assert.equal(out.won, false);
  assert.equal(out.token, 'WINNER', 'the loser must adopt the stored token');
  assert.equal(db._row().token, 'WINNER', 'and must not overwrite it');
});

test('a refresh the Graph API rejects reports why and stores nothing', async () => {
  const db = makeDb({ account_slug: 'shadesofirony', token: 'OLD', refreshed_at: 'v1' });
  supa.__setClient(db);
  getHandler = async () => {
    const e = new Error('nope');
    e.response = { data: { error: { code: 190, message: 'Session has been invalidated' } } };
    throw e;
  };

  const out = await refreshToken(ACCOUNT);
  assert.equal(out.ok, false);
  assert.match(out.error, /expired or invalid/);
  assert.equal(db._row().token, 'OLD');
});

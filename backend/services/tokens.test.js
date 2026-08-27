const test = require('node:test');
const assert = require('node:assert/strict');

const supa = require('./supabase');
const { resolveToken, storeToken, TokenError } = require('./tokens');

const ACCOUNT = Object.freeze({ slug: 'shadesofirony', handle: '@shadesofirony', igUserId: '17841400000000000' });
const OTHER = Object.freeze({ slug: 'second', handle: '@second', igUserId: '17841400000000001' });

// In-memory stand-in for the ig_tokens table. Supports exactly the two shapes
// tokens.js uses: select().eq().maybeSingle(), and update().eq().eq().select().
// Hooks let a test commit a competing write in the middle of a compare-and-set.
function makeDb(initial = null, hooks = {}) {
  let row = initial ? { ...initial } : null;

  function builder() {
    const q = { _filters: {}, _op: null, _payload: null };

    q.select = () => {
      if (q._op !== 'update') { q._op = 'select'; return q; }
      if (hooks.beforeUpdate) hooks.beforeUpdate(setRow, () => row);
      if (!row || q._filters.refreshed_at !== row.refreshed_at) return Promise.resolve({ data: [], error: null });
      row = { ...row, ...q._payload };
      return Promise.resolve({ data: [{ refreshed_at: row.refreshed_at }], error: null });
    };
    q.eq = (col, val) => { q._filters[col] = val; return q; };
    q.maybeSingle = async () => (hooks.readError
      ? { data: null, error: hooks.readError }
      : { data: row, error: null });
    q.update = (payload) => { q._op = 'update'; q._payload = payload; return q; };
    q.insert = async (payload) => {
      if (hooks.beforeInsert) hooks.beforeInsert(setRow);
      if (row) {
        // The row vanishing between the duplicate and the reread is the case
        // where there is no winner to adopt.
        if (hooks.afterDuplicate) hooks.afterDuplicate(setRow);
        return { error: { code: '23505', message: 'duplicate key value' } };
      }
      row = { ...payload };
      return { error: null };
    };
    return q;
  }

  function setRow(next) { row = next ? { ...next } : null; }
  return { from: () => builder(), _row: () => row };
}

function useDb(db) { supa.__setClient(db); return db; }

test.afterEach(() => { supa.__reset(); delete process.env.INSTAGRAM_ACCESS_TOKEN; });

test('reads the stored token and hands back its version', async () => {
  useDb(makeDb({ account_slug: 'shadesofirony', token: 'FROM_DB', refreshed_at: '2026-08-26T10:00:00.000Z' }));
  const t = await resolveToken(ACCOUNT);
  assert.equal(t.token, 'FROM_DB');
  assert.equal(t.source, 'ig_tokens');
  assert.equal(t.version, '2026-08-26T10:00:00.000Z');
});

test('the stored token wins over the legacy environment one', async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'FROM_ENV';
  useDb(makeDb({ account_slug: 'shadesofirony', token: 'FROM_DB', refreshed_at: 'v1' }));
  assert.equal((await resolveToken(ACCOUNT)).token, 'FROM_DB');
});

test('falls back to the environment token only for the legacy account', async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'FROM_ENV';
  useDb(makeDb(null));
  const t = await resolveToken(ACCOUNT);
  assert.equal(t.token, 'FROM_ENV');
  assert.equal(t.version, null);
  await assert.rejects(() => resolveToken(OTHER), TokenError);
});

test('a missing token is an error, not an empty string', async () => {
  useDb(makeDb(null));
  await assert.rejects(() => resolveToken(ACCOUNT), TokenError);
});

test('a read failure surfaces instead of looking like no token', async () => {
  useDb(makeDb(null, { readError: { message: 'permission denied for table ig_tokens' } }));
  await assert.rejects(() => resolveToken(ACCOUNT), /permission denied/);
});

test('stores a first token by insert', async () => {
  const db = useDb(makeDb(null));
  const out = await storeToken(ACCOUNT, 'NEW', { expectedVersion: null });
  assert.equal(out.won, true);
  assert.equal(db._row().token, 'NEW');
});

test('compare-and-set succeeds when the version still matches', async () => {
  const db = useDb(makeDb({ account_slug: 'shadesofirony', token: 'OLD', refreshed_at: 'v1' }));
  const out = await storeToken(ACCOUNT, 'NEW', { expectedVersion: 'v1' });
  assert.equal(out.won, true);
  assert.equal(db._row().token, 'NEW');
});

test('a refresh that loses the race adopts the winning token and does not overwrite it', async () => {
  // Another refresh commits between our read and our write.
  const db = useDb(makeDb(
    { account_slug: 'shadesofirony', token: 'OLD', refreshed_at: 'v1' },
    { beforeUpdate: (setRow) => setRow({ account_slug: 'shadesofirony', token: 'WINNER', refreshed_at: 'v2' }) },
  ));

  const out = await storeToken(ACCOUNT, 'LOSER', { expectedVersion: 'v1' });

  assert.equal(out.won, false);
  assert.equal(out.token, 'WINNER', 'must return the token that is actually live');
  assert.equal(out.version, 'v2');
  assert.equal(db._row().token, 'WINNER', 'the losing write must not land');
});

test('an insert that loses the race also adopts the winning token', async () => {
  const db = useDb(makeDb(null, {
    beforeInsert: (setRow) => setRow({ account_slug: 'shadesofirony', token: 'WINNER', refreshed_at: 'v9' }),
  }));

  const out = await storeToken(ACCOUNT, 'LOSER', { expectedVersion: null });

  assert.equal(out.won, false);
  assert.equal(out.token, 'WINNER');
  assert.equal(db._row().token, 'WINNER');
});

test('losing a race with nothing readable back is an error, not a claimed success', async () => {
  // The row is deleted rather than replaced, so the compare-and-set matches
  // nothing and there is no winner to adopt. Reporting persisted:true with the
  // caller's own token would hand back a token the database never accepted.
  const db = useDb(makeDb(
    { account_slug: 'shadesofirony', token: 'OLD', refreshed_at: 'v1' },
    { beforeUpdate: (setRow) => setRow(null) },
  ));

  await assert.rejects(
    () => storeToken(ACCOUNT, 'LOSER', { expectedVersion: 'v1' }),
    (e) => e instanceof TokenError && /nothing was persisted/.test(e.message),
  );
  assert.equal(db._row(), null);
});

test('a duplicate insert with nothing readable back is an error too', async () => {
  // A row exists at insert time, so the insert is a duplicate — then it vanishes
  // before the reread, leaving no winner to adopt.
  useDb(makeDb(null, {
    beforeInsert: (setRow) => setRow({ account_slug: 'shadesofirony', token: 'X', refreshed_at: 'v1' }),
    afterDuplicate: (setRow) => setRow(null),
  }));

  await assert.rejects(
    () => storeToken(ACCOUNT, 'LOSER', { expectedVersion: null }),
    (e) => e instanceof TokenError && /nothing was persisted/.test(e.message),
  );
});

test('with no database configured nothing is persisted and it says so', async () => {
  supa.__setClient(null, false);
  const out = await storeToken(ACCOUNT, 'NEW', { expectedVersion: null });
  assert.equal(out.persisted, false);
});

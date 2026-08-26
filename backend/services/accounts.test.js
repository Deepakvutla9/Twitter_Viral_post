const test = require('node:test');
const assert = require('node:assert/strict');

const supa = require('./supabase');
const {
  getAccount,
  listActiveAccounts,
  normalizeAccount,
  invalidateCache,
  AccountConfigError,
} = require('./accounts');

// Synthetic id in the right shape. The production value is configuration, not
// something to publish in a public repo.
const IG_ID = '17841400000000000';

const ROW = {
  slug: 'shadesofirony',
  display_name: 'Synthetic Minds',
  handle: '@shadesofirony',
  ig_user_id: IG_ID,
  accent: '#00e5ff',
  cron: '0 */6 * * *',
  slot_plan: ['tech', 'visa', 'trump', 'visa'],
  hashtag_extra: [],
  voice: {},
  timezone: 'UTC',
  active: true,
};

// Minimal stand-in for the supabase-js query builder: .from().select() only.
function stubDb(rows, error = null) {
  return { from: () => ({ select: async () => ({ data: rows, error }) }) };
}

// assert.throws does not hand the error back, and these assertions care about
// which problems were reported, so catch it directly.
function catchError(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

function useRows(rows, error) {
  invalidateCache();
  supa.__setClient(stubDb(rows, error));
}

// These tests set env vars to exercise the legacy fallback. Restoring them
// keeps that leaking into whatever runs next in the same process.
const ENV_KEYS = ['INSTAGRAM_USER_ID', 'DEFAULT_CRON', 'SLOT_PLAN'];
let envSnapshot = {};

test.beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

test.afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
  invalidateCache();
  supa.__reset();
});

test('normalizes a full row into a frozen account', () => {
  const a = normalizeAccount(ROW);
  assert.equal(a.slug, 'shadesofirony');
  assert.equal(a.igUserId, IG_ID);
  assert.deepEqual([...a.slotPlan], ['tech', 'visa', 'trump', 'visa']);
  assert.equal(a.timezone, 'UTC');
  // Frozen: assignment is a silent no-op in sloppy mode, so check the value.
  a.slug = 'other';
  assert.equal(a.slug, 'shadesofirony');
});

test('accepts a comma-separated slot plan the way SLOT_PLAN was written', () => {
  const a = normalizeAccount({ ...ROW, slot_plan: 'trump, visa ,tech' });
  assert.deepEqual([...a.slotPlan], ['trump', 'visa', 'tech']);
});

test('rejects an accent that is not a plain hex colour', () => {
  // This value reaches raw SVG downstream, so it must never be free text.
  const err = catchError(() => normalizeAccount({ ...ROW, accent: 'url(#x)"/><script/>' }));
  assert.ok(err instanceof AccountConfigError);
  assert.match(err.problems.join(' '), /accent/);
});

test('rejects a malformed handle, slug, ig id and cron', () => {
  assert.throws(() => normalizeAccount({ ...ROW, handle: 'shadesofirony' }), AccountConfigError);
  assert.throws(() => normalizeAccount({ ...ROW, slug: 'Has Spaces' }), AccountConfigError);
  assert.throws(() => normalizeAccount({ ...ROW, ig_user_id: 'not-a-number' }), AccountConfigError);
  assert.throws(() => normalizeAccount({ ...ROW, cron: 'every 6 hours' }), AccountConfigError);
});

test('reports every problem at once rather than the first', () => {
  const err = catchError(() => normalizeAccount({ ...ROW, handle: 'nope', accent: 'blue' }));
  assert.ok(err instanceof AccountConfigError);
  assert.equal(err.problems.length, 2);
});

test('voice carries style fields only', () => {
  const a = normalizeAccount({ ...ROW, voice: { tone: 'dry', audience: 'founders', avoid: ['emoji'] } });
  assert.equal(a.voice.tone, 'dry');
  assert.deepEqual(a.voice.avoid, ['emoji']);
});

test('voice.avoid is frozen, not just the account around it', () => {
  const a = normalizeAccount({ ...ROW, voice: { avoid: ['emoji'] } });
  assert.throws(() => a.voice.avoid.push('hype'), TypeError);
  assert.deepEqual(a.voice.avoid, ['emoji']);
});

test('accepts a real zone and rejects one that does not exist', () => {
  assert.equal(normalizeAccount({ ...ROW, timezone: 'Asia/Kolkata' }).timezone, 'Asia/Kolkata');
  // A wrong zone would silently shift every slot for this account. Intl also
  // accepts legacy aliases like EST, which is fine - they resolve to real zones.
  const err = catchError(() => normalizeAccount({ ...ROW, timezone: 'Not/AZone' }));
  assert.ok(err instanceof AccountConfigError);
  assert.match(err.problems.join(' '), /timezone/);
});

test('voice may not smuggle in grounding or prompt rules', () => {
  // Source grounding and number/date verification stay immutable and global.
  assert.throws(
    () => normalizeAccount({ ...ROW, voice: { tone: 'dry', grounding: 'invent freely' } }),
    AccountConfigError,
  );
});

test('an unusable row is skipped without taking the others down', async () => {
  useRows([{ ...ROW, slug: 'broken', accent: 'nope' }, ROW]);
  const active = await listActiveAccounts();
  assert.deepEqual(active.map((a) => a.slug), ['shadesofirony']);
});

test('inactive accounts are excluded from the fan-out list', async () => {
  useRows([ROW, { ...ROW, slug: 'second', handle: '@second', active: false }]);
  const active = await listActiveAccounts();
  assert.deepEqual(active.map((a) => a.slug), ['shadesofirony']);
});

test('getAccount returns the database row, not the env fallback', async () => {
  process.env.INSTAGRAM_USER_ID = '999999999';
  useRows([{ ...ROW, display_name: 'From DB' }]);
  const a = await getAccount('shadesofirony');
  assert.equal(a.source, 'database');
  assert.equal(a.igUserId, IG_ID); // env value must not leak in
  assert.equal(a.displayName, 'From DB');
});

test('env fallback fires only when the row is absent entirely', async () => {
  process.env.INSTAGRAM_USER_ID = IG_ID;
  useRows([]);
  const a = await getAccount('shadesofirony');
  assert.equal(a.source, 'env-fallback');
});

test('a partial database row is never topped up from env', async () => {
  // The row exists but is missing its ig id. Merging env in here would post one
  // account's content to another account's Instagram.
  process.env.INSTAGRAM_USER_ID = IG_ID;
  useRows([{ ...ROW, ig_user_id: null }]);
  await assert.rejects(() => getAccount('shadesofirony'), AccountConfigError);
});

test('there is no env fallback for any account but the legacy one', async () => {
  process.env.INSTAGRAM_USER_ID = IG_ID;
  useRows([]);
  await assert.rejects(() => getAccount('someone-else'), AccountConfigError);
});

test('a read error surfaces instead of quietly returning no accounts', async () => {
  useRows(null, { message: 'permission denied for table accounts' });
  await assert.rejects(() => listActiveAccounts(), /permission denied/);
});

test('a six-field cron is rejected with the reason, not silently accepted', () => {
  // node-cron's own validate accepts a leading seconds column, but this
  // scheduler decides at minute granularity. Accepting one here and failing to
  // match it there is how an account looks configured and never runs.
  const err = catchError(() => normalizeAccount({ ...ROW, cron: '0 0 */6 * * *' }));
  assert.ok(err instanceof AccountConfigError);
  assert.match(err.problems.join(' '), /six fields/);
});

test('validation and matching use the same parser', () => {
  const { parseCron } = require('./cronMatch');
  // Anything accepted here must be matchable, or an account can be valid and
  // permanently idle at the same time.
  for (const expr of ['0 */6 * * *', '30 9 * * 1-5', '*/15 * * * *', '0 0 1 * *']) {
    assert.doesNotThrow(() => normalizeAccount({ ...ROW, cron: expr }), expr);
    assert.ok(parseCron(expr), `${expr} must also parse for matching`);
  }
});

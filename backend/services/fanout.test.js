const test = require('node:test');
const assert = require('node:assert/strict');

const posted = [];
let accounts = [];
let listError = null;
const failFor = new Set();
// Hook invoked inside postCarousel. Declared here and read through the closure:
// the scheduler destructures postCarousel at require time, so swapping the
// cached export later has no effect on what it calls.
let beforePost = null;

const ACCT = (slug, extra = {}) => Object.freeze({
  slug, handle: `@${slug}`, igUserId: '17841400000000000',
  displayName: slug, accent: '#00e5ff', slotPlan: ['tech'], voice: {}, hashtagExtra: [],
  active: true, ...extra,
});

const stubs = {
  './newsScraper.js': {
    fetchNewsArticle: async () => ({}),
    fetchTrendingArticle: async (a) => ({ title: `Story ${a.slug}`, url: `https://example.com/${a.slug}`, points: 1, ogImage: null }),
    fetchVisaArticle: async (a) => ({ title: `Visa ${a.slug}`, url: `https://example.com/visa-${a.slug}`, points: 1, ogImage: null }),
    fetchTrumpArticle: async (a) => ({ title: `Trump ${a.slug}`, url: `https://example.com/trump-${a.slug}`, points: 1, ogImage: null }),
    markPosted: async () => ({ ok: true }),
  },
  './gemini.js': {
    generateCarouselSlides: async () => ({
      slides: [1, 2], caption: 'c', imagePrompt: null,
      quality: { score: 100, warnings: [], checks: { bodyLengthOk: true, bodyWordCount: 88 } },
    }),
  },
  './imageComposer.js': {
    composeSlideImages: async () => [{ filepath: 'a.jpg' }],
    cleanOldImages: () => {},
  },
  './instagram.js': {
    postCarousel: async (paths, caption, a) => {
      if (beforePost) await beforePost(a);
      if (failFor.has(a.slug)) throw new Error(`token dead for ${a.slug}`);
      posted.push(a.slug);
      return `POST_${a.slug}`;
    },
    checkToken: async () => ({ ok: true }),
    refreshToken: async () => ({ ok: true }),
  },
  './accounts.js': {
    getAccount: async (slug) => accounts.find((a) => a.slug === slug) || accounts[0],
    listActiveAccounts: async () => {
      if (listError) throw listError;
      return accounts;
    },
  },
};
for (const [rel, exports] of Object.entries(stubs)) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { runAllAccounts, getStatus, pickSource } = require('./scheduler');

// stagger: 0 everywhere — the delay is real time and proven separately below.
const run = (opts = {}) => runAllAccounts({ force: true, stagger: 0, trigger: 'test', ...opts });

test.beforeEach(() => {
  posted.length = 0;
  failFor.clear();
  listError = null;
  beforePost = null;
  accounts = [ACCT('one'), ACCT('two'), ACCT('three')];
});

test('every active account posts in one slot', async () => {
  const summary = await run();
  assert.equal(summary.accounts, 3);
  assert.equal(summary.posted, 3);
  assert.deepEqual(posted, ['one', 'two', 'three']);
});

test('one account failing does not stop the others', async () => {
  // A dead token on one handle is not a reason for the rest to miss the slot.
  failFor.add('one');
  const summary = await run();

  assert.deepEqual(posted, ['two', 'three'], 'later accounts still run');
  assert.equal(summary.posted, 2);
  assert.equal(summary.failed, 1);
  const failed = summary.results.find((r) => r.account === 'one');
  assert.match(failed.error, /token dead/);
});

test('a failure in the middle still leaves the last account running', async () => {
  failFor.add('two');
  const summary = await run();
  assert.deepEqual(posted, ['one', 'three']);
  assert.equal(summary.failed, 1);
});

test('inactive accounts are simply absent', async () => {
  accounts = [ACCT('one')];
  const summary = await run();
  assert.equal(summary.accounts, 1);
  assert.deepEqual(posted, ['one']);
});

test('runs are sequential, never overlapping', async () => {
  // Parallel runs would exhaust the Groq per-minute budget and race each other.
  let inside = 0;
  let maxConcurrent = 0;
  beforePost = async () => {
    inside += 1;
    maxConcurrent = Math.max(maxConcurrent, inside);
    await new Promise((r) => setImmediate(r));
    inside -= 1;
  };

  await run();
  assert.equal(maxConcurrent, 1);
  assert.equal(posted.length, 3, 'and all three still ran');
});

test('the fan-out summary describes the whole slot, not the last account', async () => {
  // The external trigger polls this. Watching lastResult would stop as soon as
  // the first account posted, and the polling is what keeps the instance awake.
  failFor.add('three');
  await run();

  const { lastFanOut } = getStatus();
  assert.ok(lastFanOut.finishedAt, 'finishedAt marks the whole slot done');
  assert.ok(lastFanOut.startedAt <= lastFanOut.finishedAt);
  assert.equal(lastFanOut.accounts, 3);
  assert.equal(lastFanOut.posted, 2);
  assert.equal(lastFanOut.failed, 1);
  assert.deepEqual(
    lastFanOut.results.map((r) => [r.account, r.outcome]),
    [['one', 'posted'], ['two', 'posted'], ['three', 'failed']],
  );
});

test('finishedAt is only set once every account is done', async () => {
  // Checked from inside the first account's publish, which is the moment a
  // caller watching lastResult would wrongly conclude the slot was over.
  const seen = [];
  beforePost = async (a) => { seen.push([a.slug, getStatus().lastFanOut.finishedAt]); };

  await run();

  assert.deepEqual(seen.map(([slug, fin]) => [slug, fin]), [
    ['one', null], ['two', null], ['three', null],
  ], 'never marked finished while accounts remain');
  assert.ok(getStatus().lastFanOut.finishedAt, 'and set once the slot is done');
});

test('a failure listing accounts surfaces rather than posting nothing quietly', async () => {
  listError = new Error('permission denied for table accounts');
  await assert.rejects(() => run(), /permission denied/);
});

test('the stagger actually delays the next account', async () => {
  accounts = [ACCT('one'), ACCT('two')];
  const started = Date.now();
  await runAllAccounts({ force: true, stagger: 60, trigger: 'test' });
  assert.ok(Date.now() - started >= 55, 'second account waited');
});

test('each account draws from its own slot plan', async () => {
  // Two accounts sharing one global plan would pick the same pool in the same
  // slot, which is how two handles post the same story on the same schedule.
  const noon = new Date('2026-08-26T13:00:00Z');
  const techOnly = ACCT('t', { slotPlan: ['tech'] });
  const visaOnly = ACCT('v', { slotPlan: ['visa'] });
  assert.equal(pickSource(noon, techOnly), 'tech');
  assert.equal(pickSource(noon, visaOnly), 'visa');
});

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
let markPostedResult = { ok: true };
// Slug -> when that account last published. The durable slot guard reads this,
// exactly as it reads posted_urls in production.
const history = new Map();

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
    markPosted: async () => markPostedResult,
    postedSince: async (a, since) => {
      const last = history.get(a.slug);
      return Boolean(last && new Date(last) >= new Date(since));
    },
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
  markPostedResult = { ok: true };
  history.clear();
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

// ── the five gaps from review ───────────────────────────────────────────────

test('two fan-outs cannot interleave their accounts', async () => {
  // The in-process cron and the external trigger aim at the same slot. Without a
  // fan-out lock, one would run account two while the other ran account one,
  // breaking the sequential spacing the Groq budget depends on.
  let release;
  const hold = new Promise((r) => { release = r; });
  beforePost = async (a) => { if (a.slug === 'one') await hold; };

  const first = run();
  await new Promise((r) => setImmediate(r));
  const second = await run();

  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'fan-out-in-flight');

  release();
  const firstSummary = await first;
  assert.equal(firstSummary.posted, 3, 'the first fan-out still completed in order');
  assert.deepEqual(posted, ['one', 'two', 'three']);
});

test('a fan-out that was skipped does not overwrite the last summary', async () => {
  await run();
  const good = getStatus().lastFanOut;

  let release;
  const hold = new Promise((r) => { release = r; });
  beforePost = async (a) => { if (a.slug === 'one') await hold; };
  const first = run();
  await new Promise((r) => setImmediate(r));
  await run(); // skipped
  release();
  await first;

  assert.ok(getStatus().lastFanOut.finishedAt >= good.finishedAt);
  assert.equal(getStatus().lastFanOut.accounts, 3, 'still describes a real fan-out');
});

test('an account runs when its own schedule has come up and it has not posted since', async () => {
  accounts = [
    ACCT('sixhourly', { cron: '0 */6 * * *', timezone: 'UTC' }),
    ACCT('ninonly', { cron: '0 9 * * *', timezone: 'UTC' }),
  ];
  // 12:00 and 09:00 respectively. Neither has published since, so both are owed
  // a post — including the 09:00 account, whose moment no slot window contains.
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z'),
  });

  assert.deepEqual(posted.sort(), ['ninonly', 'sixhourly']);
  assert.equal(summary.posted, 2);
});

test('a trigger hours late still covers the slot it was sent for', async () => {
  // The regression this whole rule exists for. GitHub delivered the 12:00 slot
  // at 16:31, the old 30-minute window found nothing due, and the run went green
  // having posted nothing — four times a day, for weeks.
  // A slug of its own: the in-memory double-fire guard is process-wide and keyed
  // by slug, so reusing one across tests debounces the later run.
  accounts = [ACCT('late-slot', { cron: '0 */6 * * *', timezone: 'UTC' })];
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-29T16:31:00Z'),
  });

  assert.deepEqual(posted, ['late-slot'], 'four and a half hours late is still the 12:00 slot');
  assert.equal(summary.posted, 1);
  assert.deepEqual(getStatus().lastFanOut.notDue, []);
});

test('a second trigger for the same slot does not post twice', async () => {
  accounts = [ACCT('covered', { cron: '0 */6 * * *', timezone: 'UTC' })];
  // The in-process cron already covered 12:00; the external trigger arrives late
  // for the same slot, into a process that has since restarted and so has no
  // memory of it.
  history.set('covered', new Date('2026-08-29T12:04:00Z'));

  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-29T16:31:00Z'),
  });

  assert.deepEqual(posted, [], 'the slot is already covered');
  assert.equal(summary.posted, 0);
  assert.equal(summary.error, null, 'covered is not an error');
  assert.deepEqual(getStatus().lastFanOut.alreadyPosted, ['covered']);
});

test('the next slot is a fresh obligation, not a duplicate', async () => {
  // The guard must not read "posted recently" as "nothing more to do": an
  // account that posted at 12:04 is owed another post when 18:00 comes round.
  accounts = [ACCT('next-slot', { cron: '0 */6 * * *', timezone: 'UTC' })];
  history.set('next-slot', new Date('2026-08-29T12:04:00Z'));

  await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-29T18:20:00Z'),
  });

  assert.deepEqual(posted, ['next-slot']);
});

test('a manual run ignores the schedule, which is the point of a manual run', async () => {
  accounts = [ACCT('ninonly', { cron: '0 9 * * *', timezone: 'UTC' })];
  await runAllAccounts({ force: true, stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z') });
  assert.deepEqual(posted, ['ninonly']);
});

test('an account schedule is read in its own timezone', async () => {
  // 09:00 in Kolkata is 03:30 UTC.
  accounts = [ACCT('india', { cron: '30 9 * * *', timezone: 'Asia/Kolkata' })];
  await runAllAccounts({ stagger: 0, trigger: 'test', now: new Date('2026-08-26T04:00:00Z') });
  assert.deepEqual(posted, ['india']);

  posted.length = 0;
  await runAllAccounts({ stagger: 0, trigger: 'test', now: new Date('2026-08-26T09:30:00Z') });
  assert.deepEqual(posted, [], 'not due at 09:30 UTC');
});

test('zero active accounts is an error too', async () => {
  accounts = [];
  const summary = await run();
  assert.equal(summary.accounts, 0);
  assert.match(summary.error, /no active accounts/);
  assert.ok(getStatus().lastFanOut.error);
});

test('a post that could not be recorded is reported, not swallowed', async () => {
  markPostedResult = { ok: false, error: 'permission denied' };

  const summary = await run();

  assert.equal(summary.posted, 3, 'the posts did go out');
  assert.equal(summary.unrecorded, 3, 'and every one is flagged as unrecorded');
  assert.equal(getStatus().lastFanOut.unrecorded, 3);
  assert.equal(getStatus().lastFanOut.results[0].recorded, false);
});

test('an account that can never be reached is an error, not a quiet skip', async () => {
  // 30 February. It parses, it looks like a schedule, and it will never once
  // come due — so the account sits there configured and silently never posts.
  accounts = [ACCT('impossible', { cron: '0 0 30 2 *', timezone: 'UTC' })];
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z'),
  });

  assert.equal(summary.accounts, 0);
  assert.deepEqual(summary.unreachable, ['impossible']);
  assert.match(summary.error, /never be reached/);
  assert.deepEqual(getStatus().lastFanOut.unreachable, ['impossible']);
});

test('a 09:00 account is reachable on a six-hourly trigger', async () => {
  // It used to be reported as permanently broken, because 09:00 coincides with
  // no slot. It is not broken: it comes due at 09:00 and the next trigger owes
  // it a post.
  accounts = [ACCT('nineam', { cron: '0 9 * * *', timezone: 'UTC' })];
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z'),
  });

  assert.deepEqual(summary.unreachable, []);
  assert.equal(summary.error, null);
  assert.deepEqual(posted, ['nineam']);
});

test('an account that already covered its schedule is quiet, not broken', async () => {
  // A daily account has nothing owed for most of the day. Failing there would
  // make a normal schedule look broken every day.
  accounts = [ACCT('daily', { cron: '0 18 * * *', timezone: 'UTC' })];
  history.set('daily', new Date('2026-08-25T18:04:00Z'));

  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z'),
  });

  assert.equal(summary.accounts, 0);
  assert.deepEqual(summary.unreachable, []);
  assert.equal(summary.error, null, 'covered is normal');
  assert.equal(getStatus().lastFanOut.error, null);
  // Reported apart from notDue: "already covered" and "schedule never came up"
  // look identical from outside and mean completely different things.
  assert.deepEqual(getStatus().lastFanOut.alreadyPosted, ['daily']);
  assert.deepEqual(getStatus().lastFanOut.notDue, []);
});

test('an unreachable account is reported even when another account posts', async () => {
  // The error used to be set only when nothing ran at all, so a healthy account
  // succeeding in the same slot masked a handle that will never publish again.
  accounts = [
    ACCT('works', { cron: '0 */6 * * *', timezone: 'UTC' }),
    ACCT('never', { cron: '0 0 30 2 *', timezone: 'UTC' }),
  ];
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z'),
  });

  assert.deepEqual(posted, ['works'], 'the healthy account still posts');
  assert.equal(summary.posted, 1);
  assert.deepEqual(summary.unreachable, ['never']);

  const { lastFanOut } = getStatus();
  assert.ok(lastFanOut.error, 'the slot still reports an error');
  assert.match(lastFanOut.error, /never/);
});

test('a monthly account is idle, not unreachable', async () => {
  // The seven-day scan used to call this unreachable from any date more than a
  // week before the 1st, which would have failed every slot in between.
  accounts = [ACCT('monthly', { cron: '0 0 1 * *', timezone: 'UTC' })];
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-08-02T12:00:00Z'),
  });

  assert.deepEqual(summary.unreachable, []);
  assert.equal(summary.error, null);
  assert.deepEqual(getStatus().lastFanOut.notDue, ['monthly']);
});

test('activeAccounts counts active accounts, not the ones that ran', async () => {
  // It recorded the due count, so one due account beside two idle ones reported
  // a single active account — and the status endpoint is how you check that.
  accounts = [
    ACCT('due', { cron: '0 */6 * * *', timezone: 'UTC' }),
    ACCT('idle-a', { cron: '0 0 * * *', timezone: 'UTC' }),
    ACCT('idle-b', { cron: '0 18 * * *', timezone: 'UTC' }),
  ];
  // Both idle accounts published when they last came due; only 'due' is owed
  // anything at 12:00.
  history.set('idle-a', new Date('2026-08-26T00:03:00Z'));
  history.set('idle-b', new Date('2026-08-25T18:03:00Z'));

  await runAllAccounts({ stagger: 0, trigger: 'test', now: new Date('2026-08-26T12:00:00Z') });

  const { lastFanOut } = getStatus();
  assert.equal(lastFanOut.activeAccounts, 3, 'three accounts are active');
  assert.equal(lastFanOut.dueAccounts, 1, 'one of them was owed a post');
  assert.deepEqual(lastFanOut.alreadyPosted.sort(), ['idle-a', 'idle-b']);
  assert.deepEqual(posted, ['due']);
});

test('a leap-day account is idle, not reported as broken', async () => {
  accounts = [ACCT('leap', { cron: '0 0 29 2 *', timezone: 'UTC' })];
  const summary = await runAllAccounts({
    stagger: 0, trigger: 'test', now: new Date('2026-03-15T12:00:00Z'),
  });
  assert.deepEqual(summary.unreachable, []);
  assert.equal(summary.error, null);
});

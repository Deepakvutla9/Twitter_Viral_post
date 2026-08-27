const test = require('node:test');
const assert = require('node:assert/strict');

// Same stubbing approach as scheduler.test.js: nothing downstream does real work.
const postedBy = [];
const composedFor = [];
const generatedFor = [];
const markedFor = [];

const ACCT = (slug) => Object.freeze({
  slug, handle: `@${slug}`, igUserId: '17841400000000000',
  displayName: slug, accent: '#00e5ff', slotPlan: ['tech'], voice: {}, hashtagExtra: [], active: true,
});
const ONE = ACCT('shadesofirony');
const TWO = ACCT('second');

// Holds only the named account's publish, so a test can keep one run in flight
// without blocking the other account it is trying to prove can proceed.
let holdSlug = null;
let holdPost = null;

const stubs = {
  './newsScraper.js': {
    fetchNewsArticle: async () => ({}),
    fetchTrendingArticle: async (a) => ({ title: `Story for ${a.slug}`, url: `https://example.com/${a.slug}`, points: 1, ogImage: null }),
    fetchVisaArticle: async () => { throw new Error('unused'); },
    fetchTrumpArticle: async () => { throw new Error('unused'); },
    markPosted: async (url, a) => { markedFor.push([url, a.slug]); },
  },
  './gemini.js': {
    generateCarouselSlides: async (article, topic, a) => {
      generatedFor.push(a.slug);
      return { slides: [1, 2], caption: 'c', imagePrompt: null, quality: { score: 100, warnings: [], checks: { bodyLengthOk: true, bodyWordCount: 88 } } };
    },
  },
  './imageComposer.js': {
    composeSlideImages: async (slides, opts) => { composedFor.push(opts.account.slug); return [{ filepath: 'a.jpg' }]; },
    cleanOldImages: () => {},
  },
  './instagram.js': {
    postCarousel: async (paths, caption, a) => {
      postedBy.push(a.slug);
      if (holdPost && a.slug === holdSlug) await holdPost;
      return `POST_${a.slug}`;
    },
    checkToken: async () => ({ ok: true }),
    refreshToken: async () => ({ ok: true }),
  },
  './accounts.js': {
    getAccount: async () => ONE,
    listActiveAccounts: async () => [ONE, TWO],
  },
};
for (const [rel, exports] of Object.entries(stubs)) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { runPipeline } = require('./scheduler');

test.beforeEach(() => {
  postedBy.length = 0; composedFor.length = 0; generatedFor.length = 0; markedFor.length = 0;
  holdPost = null; holdSlug = null;
});

test('the account reaches generation, rendering, posting and dedupe', async () => {
  const out = await runPipeline({ force: true, account: TWO, trigger: 'test' });
  assert.equal(out.success, true);
  assert.equal(out.account, 'second');
  assert.deepEqual(generatedFor, ['second']);
  assert.deepEqual(composedFor, ['second']);
  assert.deepEqual(postedBy, ['second']);
  assert.deepEqual(markedFor, [['https://example.com/second', 'second']]);
});

test('an explicit account overrides the default', async () => {
  await runPipeline({ force: true, account: TWO, trigger: 'test' });
  assert.deepEqual(postedBy, ['second'], 'not the default account');
});

test('with no account given it falls back to the default', async () => {
  const out = await runPipeline({ force: true, trigger: 'test' });
  assert.equal(out.account, 'shadesofirony');
});

test('the in-flight guard is per account, not global', async () => {
  // A shared guard would have silently serialised fan-out into one post per slot.
  let release;
  holdSlug = 'shadesofirony';
  holdPost = new Promise((r) => { release = r; });

  const first = runPipeline({ force: true, account: ONE, trigger: 'test' });
  await new Promise((r) => setImmediate(r));
  const second = await runPipeline({ force: true, account: TWO, trigger: 'test' });

  assert.equal(second.success, true, 'a different account must not be blocked');
  release();
  await first;
  assert.deepEqual(postedBy.sort(), ['second', 'shadesofirony']);
});

test('the same account is still blocked while a run is in flight', async () => {
  let release;
  holdSlug = 'shadesofirony';
  holdPost = new Promise((r) => { release = r; });

  const first = runPipeline({ force: true, account: ONE, trigger: 'test' });
  await new Promise((r) => setImmediate(r));
  const again = await runPipeline({ force: true, account: ONE, trigger: 'test' });

  assert.equal(again.skipped, true);
  assert.equal(again.reason, 'in-flight');
  release();
  await first;
  assert.deepEqual(postedBy, ['shadesofirony']);
});

test('the debounce window is per account too', async () => {
  // Fresh slugs: the guard maps are module state and the tests above have
  // already opened windows for ONE and TWO.
  const A = ACCT('debounce-a');
  const B = ACCT('debounce-b');

  await runPipeline({ force: true, account: A, trigger: 'test' });
  postedBy.length = 0;

  // A just ran, so it debounces; B has its own window and should proceed.
  const blocked = await runPipeline({ account: A, trigger: 'test' });
  const allowed = await runPipeline({ account: B, trigger: 'test' });

  assert.equal(blocked.skipped, true);
  assert.equal(blocked.reason, 'debounced');
  assert.equal(allowed.success, true);
  assert.deepEqual(postedBy, ['debounce-b']);
});

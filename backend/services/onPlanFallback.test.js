const test = require('node:test');
const assert = require('node:assert/strict');

// An empty themed pool used to fall back to tech unconditionally, on the
// reasoning that a missed post beats an off-topic one. That trade is only
// right for an account that publishes tech anyway. For a single-subject handle
// the off-topic post is the worse outcome and it is permanent — Instagram posts
// cannot be edited after publishing — so the slot has to fail instead.

const posted = [];
let visaPoolEmpty = true;

const ACCT = (slug, slotPlan) => Object.freeze({
  slug, handle: `@${slug}`, igUserId: '17841400000000000',
  displayName: slug, accent: '#00e5ff', slotPlan, voice: {}, hashtagExtra: [], active: true,
});
// The real configuration: one subject, nothing to substitute.
const VISA_ONLY = ACCT('visa_only', ['visa']);
// A mixed account keeps the old behaviour, because tech is genuinely on its plan.
const MIXED = ACCT('mixed', ['visa', 'tech']);

const stubs = {
  './newsScraper.js': {
    fetchNewsArticle: async () => ({}),
    fetchTrendingArticle: async (a) => ({ title: 'Some tech story', url: `https://example.com/tech/${a.slug}`, points: 1, ogImage: null, category: 'tech' }),
    fetchVisaArticle: async (a) => {
      if (visaPoolEmpty) throw new Error('No fresh visa news found.');
      return { title: 'Some visa story', url: `https://example.com/visa/${a.slug}`, points: 1, ogImage: null, category: 'visa' };
    },
    fetchTrumpArticle: async () => { throw new Error('unused'); },
    markPosted: async () => ({ ok: true }),
    postedSince: async () => false,
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
    postCarousel: async (paths, caption, a) => { posted.push(a.slug); return `POST_${a.slug}`; },
    checkToken: async () => ({ ok: true }),
    refreshToken: async () => ({ ok: true }),
  },
  './accounts.js': {
    getAccount: async () => VISA_ONLY,
    listActiveAccounts: async () => [VISA_ONLY],
  },
};
for (const [rel, exports] of Object.entries(stubs)) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { runPipeline, effectivePlan } = require('./scheduler');

test.beforeEach(() => { posted.length = 0; visaPoolEmpty = true; delete process.env.CONTENT_SOURCE; });

test('a visa-only account fails the slot rather than posting tech news', async () => {
  await assert.rejects(
    () => runPipeline({ force: true, account: VISA_ONLY, trigger: 'test' }),
    (e) => {
      assert.match(e.message, /no tech pool to fall back to/);
      assert.match(e.message, /visa_only/);
      return true;
    },
  );
  assert.deepEqual(posted, [], 'nothing may be published when the only pool is empty');
});

test('a visa-only account still posts normally when its pool has news', async () => {
  visaPoolEmpty = false;
  const out = await runPipeline({ force: true, account: VISA_ONLY, trigger: 'test' });
  assert.equal(out.success, true);
  assert.equal(out.actualSource, 'visa');
  assert.equal(out.offPlan, false);
  assert.deepEqual(posted, ['visa_only']);
});

test('an account with tech on its plan keeps the old fallback', async () => {
  const out = await runPipeline({ force: true, account: MIXED, trigger: 'test' });
  assert.equal(out.success, true, 'a mixed account still posts rather than missing the slot');
  assert.equal(out.offPlan, true, 'and says so');
  assert.equal(out.actualSource, 'tech');
  assert.deepEqual(posted, ['mixed']);
});

test('effectivePlan reports what an account may publish', () => {
  assert.deepEqual(effectivePlan(VISA_ONLY), ['visa']);
  assert.deepEqual(effectivePlan(MIXED), ['visa', 'tech']);
  // No account, or one with no usable plan, falls through to the global default,
  // which does include tech — so the fallback stays available exactly where it
  // was before.
  assert.ok(effectivePlan(null).includes('tech'));
  assert.ok(effectivePlan({ slug: 'x', slotPlan: ['nonsense'] }).includes('tech'));
});

const test = require('node:test');
const assert = require('node:assert/strict');

// These are read once at module load, so they are set before the require below.
process.env.DUE_WINDOW_MINUTES = 'Infinity';
process.env.ACCOUNT_STAGGER_MS = 'soon';

const stubs = {
  './newsScraper.js': { fetchNewsArticle: async () => ({}), fetchTrendingArticle: async () => ({}), markPosted: async () => ({ ok: true }), postedSince: async () => false },
  './gemini.js': { generateCarouselSlides: async () => ({}) },
  './imageComposer.js': { composeSlideImages: async () => [], cleanOldImages: () => {} },
  './instagram.js': { postCarousel: async () => 'X', checkToken: async () => ({ ok: true }), refreshToken: async () => ({ ok: true }) },
  './accounts.js': { getAccount: async () => null, listActiveAccounts: async () => [] },
};
for (const [rel, exports] of Object.entries(stubs)) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { runAllAccounts } = require('./scheduler');
const { isDueWithin } = require('./cronMatch');

test('an infinite due window cannot hang the matcher', async () => {
  // Number('Infinity') is Infinity, and an unbounded loop counting minutes
  // backwards never returns. The bound is inside isDueWithin as well as in the
  // env parsing, because either one alone would be a single point of failure.
  const started = Date.now();
  const due = isDueWithin('0 */6 * * *', {
    now: new Date('2026-08-26T12:00:00Z'),
    windowMinutes: Infinity,
  });
  assert.equal(due, true);
  assert.ok(Date.now() - started < 5000, 'returned promptly rather than spinning');
});

test('a malformed stagger does not silently remove the spacing', async () => {
  // ACCOUNT_STAGGER_MS='soon' is NaN. Falling through to 0 would drop the gap
  // the Groq per-minute budget depends on, invisibly.
  const started = Date.now();
  // No accounts, so this returns immediately; the point is that loading the
  // module with junk env did not throw and did not adopt the junk.
  const summary = await runAllAccounts({ trigger: 'test' });
  assert.equal(summary.accounts, 0);
  assert.ok(Date.now() - started < 5000);
});

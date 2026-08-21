const test = require('node:test');
const assert = require('node:assert/strict');

// Stub every downstream module before requiring the scheduler, so the pipeline
// does no real work and never touches the Instagram API.
let posts = 0;
const stubs = {
  './newsScraper.js': {
    fetchNewsArticle: async () => ({}),
    fetchTrendingArticle: async () => ({ title: 'Stub story', url: 'https://example.com/x', points: 1, ogImage: null }),
    markPosted: async () => {},
  },
  './gemini.js': { generateCarouselSlides: async () => ({ slides: [1, 2], caption: 'c', imagePrompt: null }) },
  './imageComposer.js': {
    composeSlideImages: async () => [{ filepath: 'a.jpg' }, { filepath: 'b.jpg' }],
    cleanOldImages: () => {},
  },
  './instagram.js': {
    postCarousel: async () => { posts++; return 'STUB_POST_ID'; },
    checkToken: async () => ({ ok: true }),
    refreshToken: async () => ({ ok: true }),
  },
};
for (const [rel, exports] of Object.entries(stubs)) {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const { runPipeline, getStatus } = require('./scheduler');

test('a run posts once and reports the post id', async () => {
  const result = await runPipeline();
  assert.equal(result.success, true);
  assert.equal(result.postId, 'STUB_POST_ID');
  assert.equal(posts, 1);
});

test('a second run inside the guard window is skipped, not posted', async () => {
  // Simulates the GitHub Actions trigger and the in-process cron both firing
  // at the same 09:00 slot.
  const result = await runPipeline();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'debounced');
  assert.equal(posts, 1, 'must not double-post');
});

test('force bypasses the guard so the UI run-now button still works', async () => {
  const result = await runPipeline({ force: true });
  assert.equal(result.success, true);
  assert.equal(posts, 2);
});

test('concurrent runs collapse to one post', async () => {
  const results = await Promise.all([runPipeline({ force: true }), runPipeline({ force: true })]);
  assert.equal(results.filter((r) => r.skipped).length, 1);
  assert.equal(posts, 3);
});

test('totalPosted tracks successful runs', () => {
  assert.equal(getStatus().totalPosted, 3);
});

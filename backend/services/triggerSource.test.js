const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseCron } = require('./cronMatch');

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'scheduled-post.yml');

// The scheduler derives its trigger schedule from this file rather than from a
// second constant, so drift between "when we think we run" and "when we run" is
// not expressible. This test guards the shape the parser depends on.
test('the workflow declares a schedule the parser can read', () => {
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  const found = [...text.matchAll(/^\s*-\s*cron:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1].trim());

  assert.ok(found.length, 'the workflow must declare at least one cron schedule');
  for (const expr of found) {
    assert.ok(parseCron(expr), `workflow cron "${expr}" must be parseable by cronMatch`);
  }
});

test('the schedule the scheduler resolves matches the workflow', () => {
  // Loaded with stubs so requiring the scheduler does no work.
  const stubs = {
    './newsScraper.js': { fetchNewsArticle: async () => ({}), fetchTrendingArticle: async () => ({}), markPosted: async () => ({ ok: true }) },
    './gemini.js': { generateCarouselSlides: async () => ({}) },
    './imageComposer.js': { composeSlideImages: async () => [], cleanOldImages: () => {} },
    './instagram.js': { postCarousel: async () => 'X', checkToken: async () => ({ ok: true }), refreshToken: async () => ({ ok: true }) },
    './accounts.js': { getAccount: async () => null, listActiveAccounts: async () => [] },
  };
  for (const [rel, exports] of Object.entries(stubs)) {
    const p = require.resolve(rel);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  delete process.env.TRIGGER_CRON;

  const { getTriggerCron } = require('./scheduler');
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  const found = [...text.matchAll(/^\s*-\s*cron:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1].trim());

  assert.deepEqual(getTriggerCron(), found, 'reachability is judged against what actually fires');
});

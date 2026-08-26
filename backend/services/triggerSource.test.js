const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { parseCron } = require('./cronMatch');
const { readWorkflowSchedules, readManifest } = require('../scripts/sync-trigger-schedule');

// render.yaml sets rootDir: backend, so .github is not deployed and the backend
// cannot read the workflow at runtime — it reads a generated manifest instead.
// These tests are the thing that stops the two drifting apart.

test('the workflow declares a schedule the parser can read', () => {
  const found = readWorkflowSchedules();
  assert.ok(found.length, 'the workflow must declare at least one cron schedule');
  for (const expr of found) {
    assert.ok(parseCron(expr), `workflow cron "${expr}" must be parseable by cronMatch`);
  }
});

test('the deployed manifest matches the workflow', () => {
  // If this fails: node scripts/sync-trigger-schedule.js
  assert.deepEqual(
    readManifest()?.schedules,
    readWorkflowSchedules(),
    'trigger-schedule.json is out of date with the workflow',
  );
});

test('the manifest lives inside the deployed directory', () => {
  // The whole point: rootDir is backend, so anything outside it is invisible in
  // production. A manifest that drifted back out of backend/ would restore the
  // bug it exists to fix.
  const render = fs.readFileSync(require('path').join(__dirname, '..', '..', 'render.yaml'), 'utf8');
  assert.match(render, /rootDir:\s*backend/, 'this test exists because of rootDir');
  assert.ok(fs.existsSync(require('path').join(__dirname, '..', 'trigger-schedule.json')));
});

function loadScheduler(env = {}) {
  for (const k of ['TRIGGER_CRON', 'TRIGGER_SOURCE']) delete process.env[k];
  Object.assign(process.env, env);
  for (const key of Object.keys(require.cache)) {
    if (key.includes('scheduler.js')) delete require.cache[key];
  }
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
  return require('./scheduler');
}

test.afterEach(() => {
  for (const k of ['TRIGGER_CRON', 'TRIGGER_SOURCE']) delete process.env[k];
});

test('with no override the schedule comes from the manifest', () => {
  assert.deepEqual(loadScheduler().getTriggerCron(), readManifest().schedules);
});

test('an unreadable override refuses to start rather than guessing', () => {
  // Reachability is judged against this. An unreadable value used to mean
  // "everything is reachable", which is a confident wrong answer.
  assert.throws(() => loadScheduler({ TRIGGER_CRON: 'not a cron' }), /not a valid schedule/);
});

test('an override disagreeing with the workflow refuses to start', () => {
  // A stale override and a genuine external trigger look identical from here,
  // and believing the wrong one declares healthy accounts unreachable.
  assert.throws(
    () => loadScheduler({ TRIGGER_CRON: '0 3 * * *' }),
    /disagrees with the workflow schedule/,
  );
});

test('a disagreeing override is accepted only when declared external', () => {
  const sched = loadScheduler({ TRIGGER_CRON: '0 3 * * *', TRIGGER_SOURCE: 'external' });
  assert.deepEqual(sched.getTriggerCron(), ['0 3 * * *']);
});

test('an override that agrees with the workflow is fine', () => {
  const schedules = readManifest().schedules;
  assert.deepEqual(loadScheduler({ TRIGGER_CRON: schedules.join(';') }).getTriggerCron(), schedules);
});

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
const { scoreTrumpArticle } = require('./newsScraper');
const { pickHashtags } = require('./contentQuality');
const { pickSource, slotPlan } = require('./scheduler');

const now = () => new Date().toISOString();
const item = (title, summary = '') => ({ title, summary, pubDate: now() });

test('a consequential story outranks an incremental mention', () => {
  const big = scoreTrumpArticle(item('Trump signs executive order on tariffs'));
  const small = scoreTrumpArticle(item('Trump attends dinner with donors'));
  assert.ok(big > small, `${big} should beat ${small}`);
});

test('Trump in the headline outranks a passing mention in the body', () => {
  const headline = scoreTrumpArticle(item('Trump orders new sanctions', ''));
  const passing = scoreTrumpArticle(item('Markets wobble on policy news', 'Analysts cited Trump sanctions'));
  assert.ok(headline > passing);
});

test('a fresh story outranks an identical older one', () => {
  const stale = { ...item('Trump signs executive order'), pubDate: new Date(Date.now() - 48 * 3600000).toISOString() };
  assert.ok(scoreTrumpArticle(item('Trump signs executive order')) > scoreTrumpArticle(stale));
});

test('politics posts get politics hashtags', () => {
  const tags = pickHashtags(5, 'politics');
  assert.equal(new Set(tags).size, 5);
  for (const t of tags) assert.match(t, /^#[a-z0-9]+$/);
});

test('the politics pool is distinct from the visa pool', () => {
  const politics = new Set();
  for (let i = 0; i < 400; i += 1) pickHashtags(5, 'politics').forEach((t) => politics.add(t));
  assert.ok(politics.has('#trump'));
  assert.ok(!politics.has('#studentvisa'), 'visa tags must not leak into politics posts');
});

test('the default plan covers all three pools across a day', () => {
  delete process.env.CONTENT_SOURCE;
  delete process.env.SLOT_PLAN;
  const slots = [0, 6, 12, 18].map((h) => pickSource(new Date(Date.UTC(2026, 7, 22, h))));
  assert.deepEqual(slots, ['tech', 'visa', 'trump', 'visa']);
});

test('SLOT_PLAN overrides the rotation', () => {
  delete process.env.CONTENT_SOURCE;
  process.env.SLOT_PLAN = 'trump,trump,visa,tech';
  const slots = [0, 6, 12, 18].map((h) => pickSource(new Date(Date.UTC(2026, 7, 22, h))));
  assert.deepEqual(slots, ['trump', 'trump', 'visa', 'tech']);
  delete process.env.SLOT_PLAN;
});

test('an invalid SLOT_PLAN falls back to the default rather than breaking', () => {
  delete process.env.CONTENT_SOURCE;
  process.env.SLOT_PLAN = 'nonsense,garbage';
  assert.deepEqual(slotPlan(), ['tech', 'visa', 'trump', 'visa']);
  delete process.env.SLOT_PLAN;
});

test('CONTENT_SOURCE can pin trump for a manual run', () => {
  process.env.CONTENT_SOURCE = 'trump';
  assert.equal(pickSource(new Date(Date.UTC(2026, 7, 22, 0))), 'trump');
  delete process.env.CONTENT_SOURCE;
});

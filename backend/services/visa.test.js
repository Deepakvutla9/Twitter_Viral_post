const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
const { scoreVisaArticle } = require('./newsScraper');
const { pickHashtags } = require('./contentQuality');
const { pickSource } = require('./scheduler');

const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString();

test('an H-1B story outranks a generic immigration story', () => {
  const h1b = scoreVisaArticle({ title: 'New H-1B rules hit Indian workers', summary: '', pubDate: at(1) });
  const generic = scoreVisaArticle({ title: 'Immigration debate continues', summary: '', pubDate: at(1) });
  assert.ok(h1b > generic, `${h1b} should beat ${generic}`);
});

test('an India-specific story outranks the same story about elsewhere', () => {
  const india = scoreVisaArticle({ title: 'Student visa delays hit Indian applicants', summary: '', pubDate: at(1) });
  const other = scoreVisaArticle({ title: 'Student visa delays hit Brazilian applicants', summary: '', pubDate: at(1) });
  assert.ok(india > other);
});

test('a fresh story outranks an identical day-old one', () => {
  const fresh = scoreVisaArticle({ title: 'H-1B update for Indian workers', summary: '', pubDate: at(1) });
  const stale = scoreVisaArticle({ title: 'H-1B update for Indian workers', summary: '', pubDate: at(48) });
  assert.ok(fresh > stale, 'visa rules change fast, so recency must count');
});

test('visa posts get visa hashtags, not tech ones', () => {
  const tags = pickHashtags(5, 'visa');
  assert.equal(tags.length, 5);
  for (const tag of tags) {
    assert.ok(!['#midjourney', '#python', '#aiart'].includes(tag), `${tag} is a tech tag`);
  }
});

test('tech posts still get the original pool', () => {
  const tags = pickHashtags(5);
  assert.equal(tags.length, 5);
  assert.ok(tags.every((t) => t.startsWith('#')));
});

test('an unknown category falls back to the tech pool rather than empty', () => {
  assert.equal(pickHashtags(5, 'nonsense').length, 5);
});

test('the four daily slots alternate tech and visa', () => {
  delete process.env.CONTENT_SOURCE;
  assert.equal(pickSource(new Date('2026-08-22T00:00:00Z')), 'tech');
  assert.equal(pickSource(new Date('2026-08-22T06:00:00Z')), 'visa');
  assert.equal(pickSource(new Date('2026-08-22T12:00:00Z')), 'tech');
  assert.equal(pickSource(new Date('2026-08-22T18:00:00Z')), 'visa');
});

test('each slot holds its choice for the whole 6-hour window', () => {
  // A late-firing cron or a manual run inside the same window must not flip
  // the source and post the other kind twice in a row.
  delete process.env.CONTENT_SOURCE;
  for (const h of [6, 7, 8, 9, 10, 11]) {
    assert.equal(pickSource(new Date(Date.UTC(2026, 7, 22, h))), 'visa', `hour ${h}`);
  }
  for (const h of [12, 13, 14, 15, 16, 17]) {
    assert.equal(pickSource(new Date(Date.UTC(2026, 7, 22, h))), 'tech', `hour ${h}`);
  }
});

test('a full day yields two tech and two visa posts', () => {
  delete process.env.CONTENT_SOURCE;
  const slots = [0, 6, 12, 18].map((h) => pickSource(new Date(Date.UTC(2026, 7, 22, h))));
  assert.equal(slots.filter((s) => s === 'tech').length, 2);
  assert.equal(slots.filter((s) => s === 'visa').length, 2);
});

test('CONTENT_SOURCE pins the pool for manual runs', () => {
  process.env.CONTENT_SOURCE = 'visa';
  assert.equal(pickSource(new Date('2026-08-22T00:00:00Z')), 'visa');
  process.env.CONTENT_SOURCE = 'tech';
  assert.equal(pickSource(new Date('2026-08-22T18:00:00Z')), 'tech');
  process.env.CONTENT_SOURCE = 'garbage';
  assert.equal(pickSource(new Date('2026-08-22T18:00:00Z')), 'visa', 'a bad value must not pin anything');
  delete process.env.CONTENT_SOURCE;
});

const { fetchVisaArticle } = require('./newsScraper');

test('the visa gate excludes domestic detention news', () => {
  // This story matched the old gate on the word "immigrant" alone and is not
  // visa news for workers or students going abroad.
  const CORE = require('./newsScraper');
  // Exercised through scoring: a domestic story with no visa term must not
  // outscore a genuine H-1B story.
  const domestic = scoreVisaArticle({
    title: "Cannot live like this, says West Bengal man detained in 'illegal immigrant' drive",
    summary: '', pubDate: new Date().toISOString(),
  });
  const h1b = scoreVisaArticle({
    title: 'H-1B visa rule change hits Indian tech workers',
    summary: '', pubDate: new Date().toISOString(),
  });
  assert.ok(h1b > domestic, `H-1B (${h1b}) must outrank domestic detention (${domestic})`);
});

test('fetchVisaArticle is exported and callable', () => {
  assert.equal(typeof fetchVisaArticle, 'function');
});

test('the visa hashtag pool is large enough to stay varied', () => {
  // Five tags per post, four posts a day -- a small pool would repeat the same
  // handful constantly and read as spam.
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) pickHashtags(5, 'visa').forEach((t) => seen.add(t));
  assert.ok(seen.size >= 50, `pool is only ${seen.size} tags`);
});

test('every visa tag is a single lowercase token', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) pickHashtags(5, 'visa').forEach((t) => seen.add(t));
  for (const tag of seen) {
    assert.match(tag, /^#[a-z0-9]+$/, `${tag} is not a single lowercase token`);
  }
});

test('a post never repeats the same tag', () => {
  for (let i = 0; i < 200; i += 1) {
    const tags = pickHashtags(5, 'visa');
    assert.equal(new Set(tags).size, 5);
  }
});

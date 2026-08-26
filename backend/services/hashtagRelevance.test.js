const test = require('node:test');
const assert = require('node:assert');
const { pickHashtags, normalizeAndEvaluateCarousel } = require('./contentQuality');

// Hashtags used to be drawn at random from a category-wide pool, which is how a
// story about a celebrity death ended up carrying #midjourney. These cover the
// selector actually reading the post before choosing.

test('a story about AI gets AI tags, not whatever the shuffle produced', () => {
  const tags = pickHashtags(5, undefined, 'OpenAI launches a reasoning model as Anthropic ships a rival chatbot');
  assert.ok(tags.includes('#ai'), `expected #ai in ${tags.join(' ')}`);
  assert.ok(tags.includes('#artificialintelligence'), `expected #artificialintelligence in ${tags.join(' ')}`);
});

test('an H-1B story leads with an H-1B tag, not a generic India tag', () => {
  // #h1b and #h1bvisa tie on the same phrase and ties are shuffled, so either
  // may lead — what matters is that neither loses to #indiansabroad.
  const text = 'Indian IT companies unaffected by new H-1B rules as the US raises visa fees';
  const tags = pickHashtags(5, 'visa', text);
  assert.ok(['#h1b', '#h1bvisa'].includes(tags[0]), `expected an H-1B tag first, got ${tags.join(' ')}`);
});

test('hyphenated H-1B still matches once punctuation is stripped', () => {
  // "H-1B" normalizes to the two tokens "h 1b", so a literal '#h1b' lookup
  // would never fire — the phrase term is what saves it.
  const tags = pickHashtags(5, 'visa', 'H-1B lottery results are out');
  assert.ok(tags.includes('#h1b'));
});

test('an off-topic story falls back to neutral anchors, never a wrong claim', () => {
  const obituary = 'Dolly Parton has died. The country singer and songwriter was 79.';
  const tags = pickHashtags(5, undefined, obituary);
  for (const bad of ['#midjourney', '#iphone', '#python', '#bigdata', '#nft', '#gaming']) {
    assert.ok(!tags.includes(bad), `${bad} has nothing to do with an obituary — got ${tags.join(' ')}`);
  }
});

test('match-only tags never arrive as filler', () => {
  // 500 draws on copy that matches nothing: every slot is filler, so a
  // match-only tag showing up at all means the filler path is leaking.
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    pickHashtags(5, undefined, 'A quiet morning with nothing in particular happening').forEach((t) => seen.add(t));
  }
  for (const bad of ['#midjourney', '#iphone', '#apple', '#python', '#samsung']) {
    assert.ok(!seen.has(bad), `${bad} leaked into filler`);
  }
});

test('generic words do not drag in specialist tags', () => {
  const breach = 'Ransomware gang breaches a hospital network, leaking patient data';
  const tags = pickHashtags(5, undefined, breach);
  assert.ok(tags.includes('#cybersecurity'), `expected #cybersecurity in ${tags.join(' ')}`);
  // "data" and "network" are incidental here; the data-science and neural-net
  // tags must not ride along on them.
  for (const bad of ['#datascientist', '#datascience', '#neuralnetworks', '#deeplearning']) {
    assert.ok(!tags.includes(bad), `${bad} matched on an incidental word — got ${tags.join(' ')}`);
  }
});

test('plurals match: "breaches" satisfies the "breach" term', () => {
  const tags = pickHashtags(5, undefined, 'Attacker breaches a payments provider');
  assert.ok(tags.includes('#cybersecurity') || tags.includes('#security'), tags.join(' '));
});

test('the same story twice does not produce an identical caption line', () => {
  // Ties are shuffled so a recurring topic still varies; without that, every
  // Trump post would carry the same five tags and read as a bot.
  const text = 'Trump signs an executive order on tariffs, escalating the trade fight with China';
  const draws = new Set();
  for (let i = 0; i < 40; i += 1) draws.add(pickHashtags(5, 'politics', text).join(' '));
  assert.ok(draws.size > 1, 'relevance ranking froze the output completely');
});

test('still exactly five unique tags, whatever the copy', () => {
  const samples = ['', 'Trump tariffs', 'A very long story about nothing at all in particular', 'AI AI AI AI'];
  for (const text of samples) {
    for (const category of [undefined, 'visa', 'politics']) {
      const tags = pickHashtags(5, category, text);
      assert.equal(tags.length, 5, `${category}/${text}`);
      assert.equal(new Set(tags).size, 5, `duplicate tag for ${category}/${text}`);
    }
  }
});

test('the caption a real carousel ships carries tags drawn from its own slides', () => {
  const parsed = {
    caption: 'The visa math just changed for thousands of workers. What happens next?',
    slides: [
      { type: 'hook', badge: 'NEWS', teaser: 'A costly new rule', headline: 'ignored — the article title wins' },
      { type: 'detail', body: 'The H-1B fee increase lands on employers who sponsor Indian workers, and immigration lawyers expect petitions to fall.' },
    ],
  };
  const article = { title: 'US raises H-1B visa fees sharply', category: 'visa' };

  const { caption } = normalizeAndEvaluateCarousel(parsed, article);
  const tags = caption.split('\n').pop().split(' ');
  assert.equal(tags.length, 5);
  assert.ok(tags.includes('#h1b'), `expected #h1b in ${tags.join(' ')}`);
});

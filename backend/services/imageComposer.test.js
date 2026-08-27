const test = require('node:test');
const assert = require('node:assert/strict');
const { fitBody, wrapHighlighted } = require('./imageComposer');

// Mirrors the ladder and available height used by the detail slide.
const STEPS = [
  { size: 48, lh: 66, maxChars: 28 },
  { size: 44, lh: 60, maxChars: 31 },
  { size: 40, lh: 55, maxChars: 34 },
  { size: 36, lh: 50, maxChars: 38 },
  { size: 32, lh: 45, maxChars: 43 },
  { size: 28, lh: 40, maxChars: 49 },
];
const AVAIL_HEIGHT = (1080 - 58 - 40) - 120;

const trim = (text, maxLines, maxChars) => wrapHighlighted(text, maxChars).slice(0, maxLines);
const wordsIn = (lines) => lines.flat().map((w) => w.w).join(' ');

const NINETY_WORDS = [
  "Ramp's latest data, covering over 70,000 U.S. firms, shows OpenAI's share of paying",
  "business users rising to nearly 40% while Anthropic sits at about 44% as of July.",
  'The gap narrowed from May, when Anthropic led 41% to 39%, indicating a steady gain',
  'for OpenAI in Q3. Economist Ara Kharazian notes OpenAI is growing faster this',
  'quarter, though a month remains. Adoption among Ramp customers hit 56% by July,',
  'up from 50% in March. **OpenAI market share climbs to nearly 40%** as competition',
  'stays volatile and enterprise buyers keep switching between the two vendors.',
].join(' ');

test('a full-length body keeps every sentence', () => {
  // The bug: a 48px body fit ~280 characters, so everything past the first
  // sentence was silently trimmed and the post read as incomplete.
  const fitted = fitBody(NINETY_WORDS, AVAIL_HEIGHT, STEPS, trim);
  assert.equal(fitted.truncated, false);
  const rendered = wordsIn(fitted.lines);
  assert.match(rendered, /stays volatile/, 'the last sentence must survive');
  assert.match(rendered, /Kharazian/, 'the middle of the body must survive');
});

test('no words are lost between the source body and the rendered lines', () => {
  const fitted = fitBody(NINETY_WORDS, AVAIL_HEIGHT, STEPS, trim);
  const source = NINETY_WORDS.replace(/\*\*/g, '').split(/\s+/).filter(Boolean).length;
  const rendered = wordsIn(fitted.lines).split(/\s+/).filter(Boolean).length;
  assert.equal(rendered, source);
});

test('the type shrinks only as far as it needs to', () => {
  const fitted = fitBody(NINETY_WORDS, AVAIL_HEIGHT, STEPS, trim);
  assert.ok(fitted.size < 48, 'a long body cannot fit at the largest size');
  assert.ok(fitted.size >= 28, 'and must not shrink past the smallest step');
});

test('a short body still renders at the original full size', () => {
  const fitted = fitBody('OpenAI shipped a new model today.', AVAIL_HEIGHT, STEPS, trim);
  assert.equal(fitted.size, 48);
  assert.equal(fitted.truncated, false);
});

test('the fitted block never overflows the available height', () => {
  for (const body of [NINETY_WORDS, 'Short one.', NINETY_WORDS + ' ' + NINETY_WORDS]) {
    const fitted = fitBody(body, AVAIL_HEIGHT, STEPS, trim);
    assert.ok(
      fitted.lines.length * fitted.lh <= AVAIL_HEIGHT,
      `block of ${fitted.lines.length} lines at ${fitted.lh}px overflows`,
    );
  }
});

test('an absurdly long body truncates rather than overflowing', () => {
  const huge = new Array(20).fill(NINETY_WORDS).join(' ');
  const fitted = fitBody(huge, AVAIL_HEIGHT, STEPS, trim);
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.lines.length * fitted.lh <= AVAIL_HEIGHT);
});

// ── headline fitting ────────────────────────────────────────────────────────

const { fitHeadline } = require('./imageComposer');

const HEAD_BOTTOM = 1080 - 58 - 52;
const rendered = (r) => r.lines.map((l) => l.map((w) => w.w).join(' ')).join(' ').replace(/\*\*/g, '');

test('the headline that published half-finished now renders whole', () => {
  // Published as "...free AI-powered study tool for" — the word "students" was
  // dropped because the wrap produced six lines and the cap was five.
  const title = 'Adobe launches Acrobat-based Student Spaces, a free AI-powered study tool for students';
  const fit = fitHeadline(title, HEAD_BOTTOM);

  assert.equal(rendered(fit), title);
  assert.equal(fit.truncated, false);
  assert.ok(fit.lines.length > 5, 'and it needed more than the old five-line cap');
});

test('a headline is never silently shortened', () => {
  // The old code cut without saying so. Anything dropped now sets truncated.
  const titles = [
    'Tim Curry has died',
    'Nvidia in talks to buy Hugging Face for 13 billion dollars',
    'France reaches 94.9% fiber coverage in 2026 after a decade of rollout',
    'US religious freedom panel urges sanctions on RSS members over Mohan Bhagwat visit',
    'International students hit hard as Australia suddenly halts new visa processing for the year',
  ];
  for (const title of titles) {
    const fit = fitHeadline(title, HEAD_BOTTOM);
    assert.equal(fit.truncated, false, title);
    assert.equal(rendered(fit), title, title);
  }
});

test('short headlines keep the large type they were designed for', () => {
  // The fix must not shrink headlines that already fitted, nor blow short ones
  // up to fill the slide.
  assert.equal(fitHeadline('Tim Curry has died', HEAD_BOTTOM).size, 96);
  assert.equal(fitHeadline('Nvidia in talks to buy Hugging Face for 13 billion dollars', HEAD_BOTTOM).size, 72);
});

test('the type steps down before anything is dropped', () => {
  // Roughly 220 characters is where nine lines at 72px stop fitting. The old
  // code would have cut this at five lines; it now shrinks and keeps every word.
  const long = ('headline words that keep going and going and going '.repeat(5)).trim();
  const fit = fitHeadline(long, HEAD_BOTTOM);

  assert.ok(fit.size < 72, `expected a smaller size, got ${fit.size}px`);
  assert.equal(fit.truncated, false);
  assert.equal(rendered(fit), long);
});

test('truncation still exists as a last resort, and admits it', () => {
  const absurd = 'word '.repeat(200).trim();
  const fit = fitHeadline(absurd, HEAD_BOTTOM);
  assert.equal(fit.truncated, true, 'something this long cannot fit');
  assert.equal(fit.size, 46, 'and only after every size was tried');
});

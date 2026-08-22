const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
const { hasRealContent, stripBoilerplate } = require('./newsScraper');

// The exact text that reached the model and produced a carousel full of
// invented percentages, dollar figures and company names.
const ET_BOILERPLATE = [
  '(Join our ETNRI WhatsApp channel for all the latest updates)',
  '(Catch all the Business News, Breaking News, and Latest News Updates on The Economic Times.)',
  'Subscribe to The Economic Times Prime and read the ET ePaper online.',
].join('\n\n');

test('the boilerplate that caused fabricated visa figures is rejected', () => {
  assert.equal(ET_BOILERPLATE.length, 224, 'this is the exact text that got through');
  assert.equal(stripBoilerplate(ET_BOILERPLATE), '');
  assert.equal(hasRealContent(ET_BOILERPLATE), false);
});

test('the old 200-character bar would have let it through', () => {
  // Guards the regression: length alone is not a content check.
  assert.ok(ET_BOILERPLATE.length > 200);
});

test('real reporting passes', () => {
  const article = 'The court ruled on Tuesday that the policy was unlawful. '.repeat(20);
  assert.equal(hasRealContent(article), true);
});

test('real reporting survives having boilerplate appended', () => {
  const article = 'The court ruled on Tuesday that the policy was unlawful. '.repeat(20);
  const withPromo = `${article}\n\n${ET_BOILERPLATE}`;
  assert.equal(hasRealContent(withPromo), true);
  assert.ok(!stripBoilerplate(withPromo).includes('WhatsApp channel'));
});

test('a headline padded to length is still rejected as too short', () => {
  assert.equal(hasRealContent('US employers rethink H-1B talent strategy as Trump policies tighten'), false);
});

test('empty and missing input are handled', () => {
  assert.equal(hasRealContent(''), false);
  assert.equal(hasRealContent(null), false);
  assert.equal(hasRealContent(undefined), false);
});

const test = require('node:test');
const assert = require('node:assert');
const { isAiStory, scoreAiStory, assess } = require('./aiTopics');

const story = (title, extra = {}) => ({
  title,
  summary: extra.summary || '',
  pubDate: extra.pubDate || new Date().toISOString(),
  hnPoints: extra.hnPoints || 0,
});

// The five subjects the account exists for. If the gate stops admitting one of
// these, its tech slots quietly go off-topic, which is the failure this file is
// here to catch.
const SUBJECTS = [
  'OpenAI releases GPT-6 to all ChatGPT users',
  'Anthropic says Claude can now run a browser unattended',
  'Google folds Gemini into search results worldwide',
  'A new open-weights LLM matches frontier models on math',
  'AI agents are booking flights without a human in the loop',
  'Figure ships humanoid robots to a second carmaker',
  'Boston Dynamics puts Atlas on a warehouse floor',
  'Amazon cuts 14,000 corporate jobs as AI takes over scheduling',
  'AI is wiping out entry-level white-collar hiring, study finds',
  'Nvidia unveils an inference chip for large language models',
];

test('every subject the account was set up for is admitted', () => {
  const missed = SUBJECTS.filter((s) => !isAiStory(story(s)));
  assert.deepStrictEqual(missed, [], `these should have been admitted: ${missed.join(' | ')}`);
});

// Real headlines from the pool this account was actually drawing from. Each one
// is the kind of post that prompted the filter.
const NOT_AI = [
  'Apple introduces M6 MacBook Pro',
  'Adobe launches Acrobat Spaces for teams',
  'The best noise-cancelling headphones of 2026',
  'Bitcoin climbs past its previous high',
  'A retailer announces layoffs at 40 stores',
  'Firefox ships vertical tabs to everyone',
  'PlayStation drops a new console bundle',
  'Netflix raises prices again',
];

test('the tech stories that are not AI stay out', () => {
  const wrong = NOT_AI.filter((s) => isAiStory(story(s)));
  assert.deepStrictEqual(wrong, [], `these should have been rejected: ${wrong.join(' | ')}`);
});

test('a named lab survives an off-topic word', () => {
  // Chips read as gadgets, and crypto miners buy the same hardware. A lab doing
  // something is still this account's subject.
  assert.ok(isAiStory(story('OpenAI acquires a chip startup')));
  assert.ok(isAiStory(story('Nvidia GPUs sold out as crypto miners return')));
});

test('layoffs alone are not an AI story', () => {
  const plain = story('Retail chain announces layoffs across 40 stores');
  assert.equal(isAiStory(plain), false);
  assert.deepStrictEqual(assess(plain).reasons.includes('jobs-without-ai'), true);

  // The same subject, with the cause named, is exactly what the account wants.
  assert.ok(isAiStory(story('Retail chain announces layoffs as automation replaces workers')));
});

test('"AI-powered" shopping copy does not buy admission', () => {
  assert.equal(isAiStory(story('The best AI-powered earbuds you can buy')), false);
  assert.equal(isAiStory(story('This AI-powered smartwatch tracks your sleep')), false);
});

test('an agent phrase counts in the headline, not buried in a summary', () => {
  assert.ok(isAiStory(story('AI agents are writing production code')));
  assert.equal(
    isAiStory(story('A quiet week in enterprise software', {
      summary: 'Elsewhere, a vendor mentioned ai tools in passing.',
    })),
    false,
  );
});

test('ranking puts what happened above what someone thinks', () => {
  const shipped = scoreAiStory(story('Anthropic releases Claude 5'));
  const opinion = scoreAiStory(story('Opinion: what to know about Claude, explained'));
  assert.ok(shipped > opinion, `${shipped} should beat ${opinion}`);
});

test('ranking rewards a story that is about more than one bucket', () => {
  const both = scoreAiStory(story('OpenAI cuts jobs as its agents take over support'));
  const one = scoreAiStory(story('OpenAI updates its developer documentation'));
  assert.ok(both > one, `${both} should beat ${one}`);
});

test('fresher wins when the subject is equal', () => {
  const now = scoreAiStory(story('Gemini ships a new model', { pubDate: new Date().toISOString() }));
  const old = scoreAiStory(story('Gemini ships a new model', {
    pubDate: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
  }));
  assert.ok(now > old, `${now} should beat ${old}`);
});

test('a story with no signal at all is rejected with a reason worth reading', () => {
  const { admit, reasons } = assess(story('Council approves new bus lane'));
  assert.equal(admit, false);
  assert.deepStrictEqual(reasons, ['no-ai-signal']);
});

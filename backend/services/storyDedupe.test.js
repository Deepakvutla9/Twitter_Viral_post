const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGuard, slugToText } = require('./storyDedupe');

const NOW = Date.parse('2026-10-13T22:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

// The real @yichi_padesta history that ran the OPT fee three times in six days.
const HISTORY = [
  [0, 'https://indianexpress.com/article/education/study-abroad/us-proposes-70000-fee-for-first-time-opt-participation-by-international-students-10911876/'],
  [1, 'https://www.federalregister.gov/documents/2026/10/08/2026-20660/optional-practical-training-fees'],
  [2, 'https://www.hindustantimes.com/world-news/us-news/h1b-is-a-business-model-trump-official-defends-tech-firm-suspensions-claims-visa-program-is-costing-americans-jobs-101791680529306.html'],
  [3, 'https://thepienews.com/us-probes-nine-unis-over-j-1-visas-and-suspends-firms-green-card-pathway/'],
  [5, 'https://thepienews.com/trump-administration-proposes-70000-opt-fee/'],
  [7, 'https://www.hindustantimes.com/world-news/us-news/h1b-visa-fraud-us-lawmaker-rich-mccormick-flags-atlanta-as-hotspot-amid-immigration-crackdowns-101791321724591.html'],
  [8, 'https://timesofindia.indiatimes.com/world/us/us-f-1-visa-indian-student-claims-october-interview-date-got-canceled-for-refusing-to-pay-agent-extra-20000/articleshow/134716804.cms'],
].map(([d, url]) => ({ url, postedAt: daysAgo(d) }));

const guard = buildGuard(HISTORY, NOW);

test('slug becomes the headline, ids and extensions dropped', () => {
  assert.equal(
    slugToText('https://www.hindustantimes.com/world-news/us-news/h1b-visa-fraud-us-lawmaker-101791321724591.html'),
    'h1b visa fraud us lawmaker',
  );
  assert.match(slugToText(HISTORY[0].url), /^us proposes 70000 fee for first time opt/);
});

test('the same OPT fee announcement from another outlet is blocked', () => {
  for (const title of [
    'US proposes $70,000 fee for OPT, hitting Indian students hardest',
    'Trump administration wants $70K charge on Optional Practical Training',
    'OPT fee of $70,000: what international students need to know',
  ]) assert.ok(guard.blocked({ title }), title);
});

test('a different OPT angle on the same fee saga is blocked inside the saga window', () => {
  assert.match(guard.blocked({ title: 'Optional Practical Training fee comment period opens' }), /story line/);
});

test('unrelated immigration news is not blocked', () => {
  for (const title of [
    'Visa bulletin for November: EB-3 India moves forward',
    'What to do within 60 days if you are laid off on an H-1B',
    'GRE and TOEFL changes announced for 2027 intake',
    'Hyderabad consulate adds F-1 interview slots',
  ]) assert.equal(guard.blocked({ title }), null, title);
});

test('same program, different angle is allowed but ranked down', () => {
  const item = { title: 'OPT employers must now file new I-983 evaluations' };
  assert.equal(guard.blocked(item), null);
  assert.ok(guard.penalty(item) > 0);
});

test('a program absent from the last posts carries no penalty', () => {
  assert.equal(guard.penalty({ title: 'Visa bulletin for November: EB-3 India moves forward' }), 0);
});

test('a saga past its window is allowed again, an event is not', () => {
  const old = buildGuard([{ url: HISTORY[4].url, postedAt: daysAgo(12) }], NOW);
  assert.equal(old.blocked({ title: 'Optional Practical Training fee comment period opens' }), null);
  assert.ok(old.blocked({ title: 'US proposes $70,000 fee for OPT' }));
});

test('an unreadable slug never matches everything', () => {
  const g = buildGuard([{ url: 'https://example.com/a/12345678', postedAt: daysAgo(1) }], NOW);
  assert.equal(g.size, 0);
  assert.equal(g.blocked({ title: 'US proposes $70,000 fee for OPT' }), null);
});

test('a terse Federal Register title still matches the saga it belongs to', () => {
  const g = buildGuard(
    [{ url: 'https://thepienews.com/trump-administration-proposes-70000-opt-fee/', postedAt: daysAgo(4) }],
    NOW,
  );
  assert.match(g.blocked({ title: 'Optional Practical Training Fees' }), /story line/);
});

const { coverageCounts, coverageBonus, matchesTrend } = require('./storyDedupe');

test('the same event across outlets counts each outlet once', () => {
  const items = [
    { title: 'US proposes $70,000 fee for OPT', source: 'PIE News' },
    { title: 'Trump administration wants $70K charge on Optional Practical Training', source: 'HT World' },
    { title: 'OPT fee of $70,000: what students need to know', source: 'ET NRI' },
    { title: 'OPT fee of $70,000: what students need to know', source: 'ET NRI' },   // same outlet twice
    { title: 'Hyderabad consulate adds F-1 interview slots', source: 'TOI NRI' },
  ];
  const c = coverageCounts(items);
  assert.equal(c.get(items[0]), 3);
  assert.equal(c.get(items[4]), 1);
});

test('three different OPT articles are not three outlets on one story', () => {
  const items = [
    { title: 'OPT employers must file new I-983 evaluations', source: 'A' },
    { title: 'Optional Practical Training fee comment period opens', source: 'B' },
    { title: 'STEM OPT unemployment limit explained', source: 'C' },
  ];
  const c = coverageCounts(items);
  for (const i of items) assert.equal(c.get(i), 1);
});

test('coverage bonus grows with outlets and is capped', () => {
  assert.equal(coverageBonus(1), 0);
  assert.ok(coverageBonus(3) > coverageBonus(2));
  assert.equal(coverageBonus(9), coverageBonus(4));
});

test('a trending term must appear whole in the headline', () => {
  assert.ok(matchesTrend({ title: 'OPT fee hike: what students must know' }, ['opt fee']));
  assert.ok(!matchesTrend({ title: 'OPT employers must file new forms' }, ['opt fee']));
  assert.ok(!matchesTrend({ title: 'Anything about OPT' }, ['opt']));   // one word is too loose
});

test('headlines that differ in plurals and abbreviations are still one event', () => {
  const items = [
    { title: 'US probes 9 universities over J-1 exchange visas as Trump tightens student rules', source: 'IE Education' },
    { title: 'US probes nine unis over J-1 visas and suspends firms’ green card pathway', source: 'PIE News' },
  ];
  assert.equal(coverageCounts(items).get(items[0]), 2);
});

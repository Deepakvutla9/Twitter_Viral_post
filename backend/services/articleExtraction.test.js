const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
const { extractArticleText, hasRealContent, stripBoilerplate } = require('./newsScraper');

const REPORTING = 'The department said the change would take effect in January and affect roughly 90,000 filings a year. ';

// Economic Times, in shape: an <article> wrapper holding a promo teaser, with the
// reporting itself only in JSON-LD. Under first-match extraction this page read
// as 224 characters and was dropped as thin.
const ET_SHAPE = `
<html><head>
  <meta property="og:image" content="https://example.com/lead.jpg">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"NewsArticle","articleBody":${JSON.stringify(REPORTING.repeat(12))}}
  </script>
</head><body>
  <article>
    <p>(Join our ETNRI WhatsApp channel for all the latest updates on visa news and more)</p>
    <p>(Catch all the Business News, Breaking News and Latest News Updates on The Economic Times.)</p>
    <p>Subscribe to The Economic Times Prime and read the ET ePaper online today.</p>
  </article>
</body></html>`;

// Times of India, in shape: no <article>, no <p> carrying the body at all — the
// reporting exists only as JSON-LD, and as one unbroken line with a promo
// sentence at the end.
const TOI_SHAPE = `
<html><head>
  <meta property="og:image" content="https://example.com/toi.jpg">
  <script type="application/ld+json">
    {"@graph":[{"@type":"WebPage"},{"@type":"NewsArticle","articleBody":${JSON.stringify(`${REPORTING.repeat(10)}Catch all the Business News and Latest News Updates on The Times of India.`)}}]}
  </script>
</head><body><div id="app"><div>headline furniture</div></div></body></html>`;

// An ordinary page: body in <p> tags, no structured data.
const PLAIN_SHAPE = `
<html><head><meta name="twitter:image" content="https://example.com/plain.jpg"></head>
<body><main>${REPORTING.repeat(10).split('. ').map((s) => `<p>${s}.</p>`).join('')}</main></body></html>`;

test('the reporting is found when the visible markup holds only a promo teaser', () => {
  const { text, ogImage } = extractArticleText(ET_SHAPE);
  assert.ok(hasRealContent(text), `only got ${stripBoilerplate(text).length} chars`);
  assert.ok(text.includes('take effect in January'));
  assert.equal(ogImage, 'https://example.com/lead.jpg');
});

test('the longest real body wins, not the first container that matches', () => {
  // The <article> teaser matches an earlier selector than anything else on the
  // page. Taking it was the bug: 224 characters of promo beat 3,800 of reporting.
  const { text } = extractArticleText(ET_SHAPE);
  assert.ok(text.length > 1000);
  assert.ok(!text.startsWith('(Join our ETNRI'));
});

test('a page with no article paragraphs at all still yields its body', () => {
  const { text, ogImage } = extractArticleText(TOI_SHAPE);
  assert.ok(hasRealContent(text));
  assert.equal(ogImage, 'https://example.com/toi.jpg');
});

test('a promo sentence does not take the article with it', () => {
  // The body arrives as one unbroken line. Dropping the whole line for one promo
  // sentence inside it read as "no content" and pushed the slot off topic.
  const { text } = extractArticleText(TOI_SHAPE);
  const kept = stripBoilerplate(text);
  assert.ok(kept.length > 800, `kept only ${kept.length} chars`);
  assert.ok(!kept.includes('Catch all the Business News'));
});

test('ordinary pages are unaffected', () => {
  const { text, ogImage } = extractArticleText(PLAIN_SHAPE);
  assert.ok(hasRealContent(text));
  assert.equal(ogImage, 'https://example.com/plain.jpg');
});

test('structured data that is malformed is skipped, not fatal', () => {
  const broken = `<html><head><script type="application/ld+json">{not json</script></head>
    <body><main>${REPORTING.repeat(10).split('. ').map((s) => `<p>${s}.</p>`).join('')}</main></body></html>`;
  const { text } = extractArticleText(broken);
  assert.ok(hasRealContent(text), 'the visible body is still there');
});

test('a page with nothing on it returns empty rather than throwing', () => {
  const { text, ogImage } = extractArticleText('<html><body></body></html>');
  assert.equal(text, '');
  assert.equal(ogImage, null);
  assert.equal(hasRealContent(text), false);
});

test('pure boilerplate is still rejected', () => {
  // The guard that stopped the model inventing visa figures from a promo block.
  const promoOnly = `<html><body><article>
    <p>(Join our ETNRI WhatsApp channel for all the latest updates on immigration)</p>
    <p>Subscribe to The Economic Times Prime and read the ET ePaper online today.</p>
    <p>(Catch all the Business News, Breaking News and Latest News Updates here.)</p>
  </article></body></html>`;
  const { text } = extractArticleText(promoOnly);
  assert.equal(hasRealContent(text), false);
});

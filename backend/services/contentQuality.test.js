const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countHighlights,
  extractHashtags,
  normalizeAndEvaluateCarousel,
  evaluateCarouselContent,
} = require('./contentQuality');

test('normalizes generated content into exactly two slides', () => {
  const result = normalizeAndEvaluateCarousel(
    {
      slides: [
        { type: 'detail', body: 'This is the first sentence. This is the second sentence. This is the third sentence. This is the fourth sentence. **This phrase carries the point** for the reader. This closing sentence makes the takeaway clear.' },
        { type: 'hook', badge: 'ai', teaser: 'Look closer' },
      ],
      caption: 'This matters now.\n#AI #Startups #TechNews #Creators #Future',
      imagePrompt: 'Photorealistic technology newsroom scene.',
    },
    { title: 'AI startup funding jumps again' }
  );

  assert.equal(result.slides.length, 2);
  assert.equal(result.slides[0].type, 'hook');
  assert.equal(result.slides[0].headline, 'AI startup funding jumps again');
  assert.equal(result.slides[0].badge, 'AI UPDATE');
  assert.equal(result.slides[1].type, 'detail');
});

test('counts highlights and hashtags used by quality checks', () => {
  assert.equal(countHighlights('A **single important phrase** appears here.'), 1);
  assert.equal(countHighlights('A **first phrase** and **second phrase** appear.'), 2);
  assert.deepEqual(extractHashtags('Line\n#AI #Startups #Tech_News'), ['#AI', '#Startups', '#Tech_News']);
});

test('returns quality warnings for brittle carousel copy', () => {
  const quality = evaluateCarouselContent({
    slides: [
      { type: 'hook', headline: 'AI news', badge: 'NEWS' },
      { type: 'detail', body: 'Too short and **highlighted**?' },
    ],
    caption: 'Only one tag #AI',
  });

  assert.ok(quality.score < 80);
  assert.ok(quality.warnings.some((w) => w.startsWith('Detail body should be 70-95 words')));
  assert.ok(quality.warnings.includes('Caption should include exactly 5 hashtags.'));
  assert.ok(quality.warnings.includes('Detail body should end with a concluding statement, not a question.'));
});

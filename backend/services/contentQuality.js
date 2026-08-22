const DEFAULT_BADGE = 'NEWS';
const ALLOWED_BADGES = new Set(['NEWS', 'BREAKING', 'AI UPDATE', 'EXCLUSIVE', 'ALERT']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function countWords(value) {
  const words = cleanText(value).match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g);
  return words ? words.length : 0;
}

function countHighlights(value) {
  const matches = cleanText(value).match(/\*\*[^*][\s\S]*?[^*]\*\*/g);
  return matches ? matches.length : 0;
}

function extractHashtags(value) {
  const matches = cleanText(value).match(/(^|\s)#[A-Za-z0-9_]+/g);
  return matches ? matches.map((tag) => tag.trim()) : [];
}

// Curated Instagram hashtag pool. Every carousel posts 5 of these — chosen at
// random — instead of model-invented tags, since Instagram now favors a small,
// consistent, relevant set. Edit this list to change the hashtags in circulation.
const HASHTAG_POOL = [
  '#technology', '#tech', '#innovation', '#business', '#iphone', '#engineering',
  '#technews', '#science', '#software', '#gadgets', '#design', '#electronics',
  '#apple', '#programming', '#android', '#coding', '#ai', '#samsung',
  '#smartphone', '#security', '#cybersecurity', '#education', '#computer',
  '#instagood', '#instagram', '#pro', '#bhfyp', '#marketing', '#technologynews',
  '#artificialintelligence', '#instatech', '#art', '#digital', '#future',
  '#startup', '#mobile', '#techno', '#gadget', '#india', '#automation', '#it',
  '#computerscience', '#programmer', '#internet', '#entrepreneur', '#developer',
  '#techie', '#tecnologia', '#engineer', '#robotics', '#love', '#data',
  '#python', '#iot', '#digitalmarketing', '#oneplus', '#gaming', '#photography',
  '#machinelearning', '#aiart', '#digitalart', '#aiartcommunity', '#midjourney',
  '#datascience', '#generativeart', '#deeplearning', '#midjourneyart',
  '#aiartist', '#aiartwork', '#bigdata', '#artoftheday', '#aiartists',
  '#digitalartist', '#midjourneyai', '#artwork', '#chatgpt', '#stablediffusion',
  '#digitaltransformation', '#artist', '#neuralnetworks', '#dataanalytics',
  '#dalle', '#modernart', '#nft', '#robot', '#aigenerated', '#midjourneyartwork',
  '#analytics', '#contemporaryart', '#datascientist', '#aigeneratedart',
  '#digitalpainting', '#abstractart',
];

// Visa/immigration posts need their own tags — the tech pool above would put
// #midjourney and #python on an H-1B post, which reads as spam and reaches the
// wrong audience entirely.
const VISA_HASHTAG_POOL = [
  '#h1b', '#h1bvisa', '#visa', '#visanews', '#immigration', '#immigrationnews',
  '#greencard', '#uscis', '#studentvisa', '#f1visa', '#opt', '#stemopt',
  '#studyabroad', '#studyinusa', '#indianstudents', '#indiansabroad', '#nri',
  '#workvisa', '#usimmigration', '#immigrants', '#permanentresidency',
  '#visaapplication', '#visainterview', '#canadaimmigration', '#ukvisa',
  '#australiavisa', '#abroadstudies', '#ielts', '#desiabroad', '#overseas',
  '#greencardholder', '#employmentbasedvisa', '#travelvisa', '#consulate',
  '#visaupdate', '#immigrationupdate', '#indiansinusa', '#h4visa',
];

const HASHTAG_POOLS = { visa: VISA_HASHTAG_POOL };

// Pick `count` unique hashtags at random from the pool (Fisher–Yates shuffle).
function pickHashtags(count = 5, category) {
  const pool = (HASHTAG_POOLS[category] || HASHTAG_POOL).slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

// Build the final caption: hook text (with any model-inlined hashtags stripped)
// plus a single line of 5 hashtags chosen at random from the curated pool above.
function buildCaption(parsed, category) {
  const hookText = cleanText(parsed?.caption)
    .replace(/#\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const line = pickHashtags(5, category).join(' ');
  return line ? `${hookText}\n\n${line}` : hookText;
}

function normalizeBadge(value) {
  const badge = cleanText(value).toUpperCase();
  if (ALLOWED_BADGES.has(badge)) return badge;
  if (badge.includes('AI')) return 'AI UPDATE';
  if (badge.includes('BREAK')) return 'BREAKING';
  if (badge.includes('ALERT')) return 'ALERT';
  return DEFAULT_BADGE;
}

function normalizeSlides(parsed, article) {
  const allSlides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const hook = allSlides.find((slide) => slide?.type === 'hook') || allSlides[0] || {};

  // Context slides, in order — any non-hook slide that actually has body text.
  const details = allSlides.filter((slide) => slide && slide !== hook && cleanText(slide.body));

  const slides = [
    {
      type: 'hook',
      badge: normalizeBadge(hook.badge),
      teaser: cleanText(hook.teaser || 'What happened?'),
      headline: cleanText(article?.title || hook.headline || ''),
    },
    {
      type: 'detail',
      body: cleanText(details[0]?.body || ''),
    },
  ];

  // Optional 3rd slide: keep the model's second context slide ONLY when it has
  // real, distinct content — never a thin filler or a near-duplicate of slide 2.
  const extra = cleanText(details[1]?.body || '');
  if (extra && countWords(extra) >= 12 && extra.toLowerCase() !== slides[1].body.toLowerCase()) {
    slides.push({ type: 'detail', body: extra });
  }

  return slides;
}

function evaluateCarouselContent(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const hook = slides[0] || {};
  const detail = slides[1] || {};
  const bodyWordCount = countWords(detail.body);
  const highlightCount = countHighlights(detail.body);
  const hashtags = extractHashtags(content?.caption);
  const warnings = [];
  const checks = {
    hasTwoSlides: slides.length >= 2 && slides.length <= 3,
    hasHeadline: Boolean(cleanText(hook.headline)),
    hasDetailBody: Boolean(cleanText(detail.body)),
    bodyWordCount,
    bodyLengthOk: bodyWordCount >= 70 && bodyWordCount <= 95,
    highlightCount,
    hasSingleHighlight: highlightCount === 1,
    hashtagCount: hashtags.length,
    hasFiveHashtags: hashtags.length === 5,
    endsWithQuestion: /\?\s*$/.test(cleanText(detail.body)),
  };

  if (!checks.hasTwoSlides) warnings.push('Expected 2 or 3 slides.');
  if (!checks.hasHeadline) warnings.push('Hook slide is missing the article headline.');
  if (!checks.hasDetailBody) warnings.push('Detail slide is missing body copy.');
  if (!checks.bodyLengthOk) warnings.push('Detail body should be 70-95 words — more than that renders too small to read on a phone, so the extra belongs on slide 3.');
  if (!checks.hasSingleHighlight) warnings.push('Detail body should include exactly one highlighted phrase.');
  if (!checks.hasFiveHashtags) warnings.push('Caption should include exactly 5 hashtags.');
  if (checks.endsWithQuestion) warnings.push('Detail body should end with a concluding statement, not a question.');

  const score =
    (checks.hasTwoSlides ? 20 : 0) +
    (checks.hasHeadline ? 15 : 0) +
    (checks.hasDetailBody ? 15 : 0) +
    (checks.bodyLengthOk ? 20 : 0) +
    (checks.hasSingleHighlight ? 20 : 0) +
    (checks.hasFiveHashtags ? 10 : 0) -
    (checks.endsWithQuestion ? 10 : 0);

  return {
    score: Math.max(0, Math.min(100, score)),
    checks,
    warnings,
  };
}

function normalizeAndEvaluateCarousel(parsed, article) {
  const normalized = {
    slides: normalizeSlides(parsed, article),
    imagePrompt: cleanText(parsed?.imagePrompt),
    caption: buildCaption(parsed, article?.category),
  };

  return {
    ...normalized,
    quality: evaluateCarouselContent(normalized),
  };
}

module.exports = {
  pickHashtags,
  cleanText,
  countWords,
  countHighlights,
  extractHashtags,
  normalizeAndEvaluateCarousel,
  evaluateCarouselContent,
};

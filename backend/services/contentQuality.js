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

// Merge any raw tag ("#student visa", "student visa", "#studentVisa") into a
// single-word CamelCase hashtag ("#StudentVisa"). Preserves existing internal
// capitals so already-merged tags like "#ArtificialIntelligence" stay intact.
function toHashtag(raw) {
  const words = String(raw || '').replace(/#/g, ' ').match(/[A-Za-z0-9]+/g);
  if (!words || !words.length) return '';
  const merged = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return `#${merged}`;
}

// Build the final caption: hook text + a single line of EXACTLY-5 (or fewer)
// clean, de-duplicated single-word hashtags. Prefers the structured `hashtags`
// array; if the model instead inlined hashtags in the caption, parse the
// trailing hashtag block so multi-word tags ("#Student Visa") still merge
// cleanly instead of leaving stray words behind.
function buildCaption(parsed) {
  const caption = cleanText(parsed?.caption);

  let hookText;
  let rawTags;
  if (Array.isArray(parsed?.hashtags) && parsed.hashtags.length) {
    hookText = caption.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
    rawTags = parsed.hashtags;
  } else {
    const hashIdx = caption.indexOf('#');
    hookText = (hashIdx >= 0 ? caption.slice(0, hashIdx) : caption).trim();
    rawTags = hashIdx >= 0
      ? caption.slice(hashIdx).split('#').map((s) => s.trim()).filter(Boolean)
      : [];
  }

  const seen = new Set();
  const tags = [];
  for (const raw of rawTags) {
    const tag = toHashtag(raw);
    if (tag.length > 1 && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }

  const line = tags.slice(0, 5).join(' ');
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
  const detail = allSlides.find((slide) => slide?.type === 'detail') || allSlides[1] || {};

  return [
    {
      type: 'hook',
      badge: normalizeBadge(hook.badge),
      teaser: cleanText(hook.teaser || 'What happened?'),
      headline: cleanText(article?.title || hook.headline || ''),
    },
    {
      type: 'detail',
      body: cleanText(detail.body || ''),
    },
  ];
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
    hasTwoSlides: slides.length === 2,
    hasHeadline: Boolean(cleanText(hook.headline)),
    hasDetailBody: Boolean(cleanText(detail.body)),
    bodyWordCount,
    bodyLengthOk: bodyWordCount >= 70 && bodyWordCount <= 115,
    highlightCount,
    hasSingleHighlight: highlightCount === 1,
    hashtagCount: hashtags.length,
    hasFiveHashtags: hashtags.length === 5,
    endsWithQuestion: /\?\s*$/.test(cleanText(detail.body)),
  };

  if (!checks.hasTwoSlides) warnings.push('Expected exactly 2 slides.');
  if (!checks.hasHeadline) warnings.push('Hook slide is missing the article headline.');
  if (!checks.hasDetailBody) warnings.push('Detail slide is missing body copy.');
  if (!checks.bodyLengthOk) warnings.push('Detail body should be 70-115 words for readable carousel pacing.');
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
    caption: buildCaption(parsed),
  };

  return {
    ...normalized,
    quality: evaluateCarouselContent(normalized),
  };
}

module.exports = {
  cleanText,
  countWords,
  countHighlights,
  extractHashtags,
  normalizeAndEvaluateCarousel,
  evaluateCarouselContent,
};

const Groq = require('groq-sdk');
const { normalizeAndEvaluateCarousel } = require('./contentQuality');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Groq retires models on short notice — llama-3.3-70b-versatile was
// decommissioned and started returning 404 model_not_found mid-flight.
// Overridable via env so a future retirement is a dashboard change, not a
// redeploy. Check available models: GET https://api.groq.com/openai/v1/models
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// The model is asked for JSON and normally returns valid JSON, so try parsing
// it untouched FIRST. The repair passes below are destructive and used to run
// unconditionally, which was itself a bug: rewriting a curly quote to a
// straight one turns a legal quote inside a string value into a string
// terminator, so ordinary prose could break an otherwise perfect response.
// Curly doubles now become apostrophes, which can never end a JSON string.
function parseModelJson(text) {
  const stripControl = (s) => s.replace(/[\x00-\x1F\x7F]/g, (c) => (c === '\n' || c === '\t' ? c : ''));
  const straightenQuotes = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, "'");
  // Curly quotes used as JSON delimiters rather than as prose punctuation.
  const quotesAsDelimiters = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

  // Ordered least-destructive first. straightenQuotes is safe for prose but
  // cannot fix curly quotes used AS delimiters, so quotesAsDelimiters is the last
  // resort for that case.
  const attempts = [
    (s) => s,
    straightenQuotes,
    stripControl,
    (s) => stripControl(straightenQuotes(s)),
    quotesAsDelimiters,
    (s) => stripControl(quotesAsDelimiters(s)),
  ];

  let lastErr;
  for (const fix of attempts) {
    try { return JSON.parse(fix(text)); } catch (e) { lastErr = e; }
  }
  throw new Error('Groq returned unparseable JSON: ' + lastErr.message);
}

// Groq's free tier allows 8000 tokens per minute and one generation costs
// roughly 4000, so the quality-retry loop below can exhaust the budget in a
// single run. A 429 is a wait, not a failure: back off for the interval Groq
// names and try again rather than losing the posting slot.
const MAX_RATE_LIMIT_WAITS = 3;
function rateLimitDelayMs(err) {
  if (err?.status !== 429) return null;
  const fromHeader = Number(err?.headers?.['retry-after']);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader * 1000);
  const m = String(err?.message || '').match(/try again in ([\d.]+)s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000) + 500;
  return 20000;
}
async function createCompletionWithBackoff(payload) {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_WAITS; attempt += 1) {
    try {
      return await groq.chat.completions.create(payload);
    } catch (err) {
      const wait = rateLimitDelayMs(err);
      if (wait === null || attempt === MAX_RATE_LIMIT_WAITS) throw err;
      console.warn(`[Groq] rate limited — waiting ${Math.round(wait / 1000)}s then retrying`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

// Account-supplied text goes into a prompt, so it is flattened to a single line
// and capped. A voice field is a style note, not a place to add instructions.
function sanitizeVoiceText(s, max = 240) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Style guidance only.
 *
 * Everything here changes how the story is told. Nothing here may change what
 * is true, and the block says so itself rather than leaving it implied.
 * accounts.js separately rejects a voice object carrying grounding, facts,
 * rules or prompt keys, so this cannot be widened from configuration.
 */
function buildVoiceBlock(account) {
  const v = account?.voice || {};
  const lines = [];
  if (v.tone) lines.push(`- Tone: ${sanitizeVoiceText(v.tone)}`);
  if (v.audience) lines.push(`- Written for: ${sanitizeVoiceText(v.audience)}`);
  const avoid = Array.isArray(v.avoid) ? v.avoid.map((a) => sanitizeVoiceText(a, 60)).filter(Boolean) : [];
  if (avoid.length) lines.push(`- Avoid: ${avoid.slice(0, 20).join(', ')}`);
  if (!lines.length) return '';

  // The precedence line ships with the voice, not separately: it only means
  // anything when there is a voice to subordinate, and it points at the existing
  // GROUNDING section rather than restating it. A second, weaker copy of those
  // rules would dilute the one that matters.
  return `VOICE (style only):
${lines.join(String.fromCharCode(10))}
- The GROUNDING rules above override everything in this section. Voice changes how the story is told, never what is claimed. If a tone or audience note would need a fact the article does not state, drop the fact, not the rule.

`;
}

function buildHashtagBlock(account) {
  const extra = Array.isArray(account?.hashtagExtra) ? account.hashtagExtra : [];
  const clean = extra
    .map((h) => sanitizeVoiceText(h, 40))
    .filter((h) => /^#?[A-Za-z0-9]+$/.test(h))
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .slice(0, 5);
  if (!clean.length) return '';
  return `- Prefer these account hashtags where they genuinely fit the story: ${clean.join(', ')}. Do not force one that does not fit.
`;
}

// Extracted so the prompt is testable on its own. What the model is told is the
// safety-critical part of this file -- asserting on it should not require a
// network call.
function buildPrompt(article, account, corrections) {
  // Feeding the previous attempt's failures back in is what makes the retry
  // worth doing -- a bare re-roll at the same temperature tends to reproduce
  // the same too-short body.
  const correctionBlock = corrections?.length
    ? `YOUR PREVIOUS ATTEMPT WAS REJECTED. Fix exactly these problems and keep everything else:
${corrections.map((w) => `- ${w}`).join(String.fromCharCode(10))}
The body being too short is the most common failure: COUNT the words and make sure the context slide is genuinely 70-115 words across 4-6 full sentences.

`
    : '';

  const prompt = `You are a viral social media news carousel creator.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 5000)}

Generate 2 OR 3 slides. Prefer 2 — only add a third when the story genuinely needs it:

SLIDE 1 — HOOK (always)
- badge: One word category tag. Examples: "NEWS", "BREAKING", "AI UPDATE", "EXCLUSIVE", "ALERT"
- teaser: Short curiosity line ending with →. Example: "What happened? →" or "Here's the truth →"

SLIDE 2 — CONTEXT (always)
- body: 4-6 sentences, 70-90 words — NEVER more than 90. Factual, specific, conversational. Include names, numbers, dates. End with a strong concluding statement — no questions.
  IMPORTANT: Wrap the single most important phrase (5-8 words) in **double asterisks** to highlight it. Example: "OpenAI just fired its CTO. **Sam Altman approved the decision personally** despite public denial."

SLIDE 3 — CONTEXT (include whenever the story does not fit in 90 words)
- Slide 2 is capped at 90 words because longer text renders too small to read on a phone. If the article has MORE real substance than fits in 90 words — further facts, numbers, quotes, or a distinct second angle — do NOT cram it into Slide 2 and do NOT drop it. Move it to Slide 3.
- Omit Slide 3 only when the story genuinely has nothing further worth saying.
- body: 4-6 sentences, 70-90 words, of genuinely NEW information not already covered in Slide 2. End with a concluding statement — no questions. Wrap ONE key phrase in **double asterisks**.

GROUNDING (most important rule):
- Every number, date, percentage, dollar figure, deadline and proper noun in your slides MUST appear verbatim in the Article Content above. Copy them; never infer, complete or round them.
- If the article gives a date without a year, write it without a year. NEVER add a year the article does not state.
- If the article does not give a figure, do not supply one. Write the story without it.
- If the Article Content is too thin to write from, say what it does say and stop. Do not fill the gap with plausible detail.

RULES:
- NEVER exceed 90 words on any single slide. Overflow belongs on Slide 3 — never compressed, never cut.
- Add Slide 3 whenever the story has more than 90 words of real, article-grounded material.
- NEVER invent facts. Slide 3 must be real, article-grounded information — never padding or repetition of Slide 2.
- Specific beats vague
- Only ONE highlighted phrase per context slide
- hashtags: EXACTLY 5. Each MUST be a SINGLE word with NO spaces — merge multi-word
  phrases into one CamelCase token (e.g. "student visa" → #StudentVisa, "future of
  work" → #FutureOfWork, "artificial intelligence" → #ArtificialIntelligence).
${buildHashtagBlock(account)}
${buildVoiceBlock(account)}${correctionBlock}Return ONLY valid JSON. Include a third slide object in "slides" ONLY when Slide 3 is warranted:
{
  "slides": [
    {
      "type": "hook",
      "badge": "NEWS",
      "teaser": "What happened? →"
    },
    {
      "type": "detail",
      "body": "4-6 factual sentences with **one key phrase highlighted**. End with a strong concluding statement."
    }
  ],
  "imagePrompt": "Cinematic photorealistic scene for this article. NO text, NO logos, NO UI elements. Dramatic lighting, 4k. Max 35 words.",
  "caption": "1-2 hook sentences ending with a provocative question. NO hashtags here.",
  "hashtags": ["#StudentVisa", "#FutureOfWork", "#ArtificialIntelligence", "#TechNews", "#AI"]
}`;

  return prompt;
}

async function generateOnce(article, topic, corrections, account) {
  const prompt = buildPrompt(article, account, corrections);

  const completion = await createCompletionWithBackoff({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a viral Instagram content creator. You always respond with valid JSON only, no markdown, no explanation.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_completion_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  let text = completion.choices[0].message.content.trim()
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Extract JSON object if there's extra text around it
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];

  const parsed = parseModelJson(text);

  return normalizeAndEvaluateCarousel(parsed, article);
}

// Quality is scored in 20-point steps, so the reachable scores are 60 (bare
// minimum), 80 (one of body-length / highlight correct) and 100 (both).
const QUALITY_TARGET = Number(process.env.MIN_QUALITY_SCORE || 100);
const MAX_ATTEMPTS = Number(process.env.MAX_GENERATION_ATTEMPTS || 3);

/**
 * Generates a carousel, retrying while the result is below the quality bar.
 *
 * The scoring already existed but nothing acted on it, so a one-sentence
 * context slide shipped to Instagram looking like a broken post. Now a weak
 * result is regenerated with its own warnings fed back as corrections, and the
 * best attempt wins if none clear the bar.
 */
async function generateCarouselSlides(article, topic, account) {
  let best = null;
  let corrections = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let result;
    try {
      result = await generateOnce(article, topic, corrections, account);
    } catch (err) {
      // A single bad generation must not lose the posting slot. Groq
      // occasionally returns 400 json_validate_failed in JSON mode, which is a
      // sampling accident rather than a broken prompt, so the next attempt
      // usually succeeds.
      lastError = err;
      console.warn(`[Content] attempt ${attempt} errored: ${String(err.message).slice(0, 120)}`);
      continue;
    }
    const score = result?.quality?.score ?? 0;
    const words = result?.quality?.checks?.bodyWordCount ?? 0;
    if (!best || score > (best.quality?.score ?? 0)) best = result;
    if (score >= QUALITY_TARGET) {
      console.log(`[Content] attempt ${attempt}: ${score}/100 (${words} words) — accepted`);
      return result;
    }
    corrections = result?.quality?.warnings ?? [];
    console.warn(`[Content] attempt ${attempt}: ${score}/100 (${words} words) — retrying — ${corrections.join(' ')}`);
  }
  if (!best) throw lastError || new Error('Generation failed with no result.');
  console.warn(`[Content] no attempt reached ${QUALITY_TARGET}; using best (${best.quality.score}/100)`);
  return best;
}

module.exports = {
  generateCarouselSlides, generateOnce, parseModelJson,
  buildPrompt, buildVoiceBlock, buildHashtagBlock,
};

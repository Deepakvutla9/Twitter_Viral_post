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

async function generateOnce(article, topic, corrections) {
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
- body: 4-6 sentences, 70-100 words. Factual, specific, conversational. Include names, numbers, dates. End with a strong concluding statement — no questions.
  IMPORTANT: Wrap the single most important phrase (5-8 words) in **double asterisks** to highlight it. Example: "OpenAI just fired its CTO. **Sam Altman approved the decision personally** despite public denial."

SLIDE 3 — CONTEXT (OPTIONAL — include ONLY when warranted)
- Add this slide ONLY if the story has substantial ADDITIONAL facts, numbers, quotes, or a distinct second angle that do NOT fit in Slide 2. For thin or simple stories, OMIT it and return just 2 slides.
- body: 4-6 sentences, 70-100 words, of genuinely NEW information not already covered in Slide 2. End with a concluding statement — no questions. Wrap ONE key phrase in **double asterisks**.

RULES:
- Default to 2 slides. Add Slide 3 only when there is clearly more worth telling.
- NEVER invent facts. Slide 3 must be real, article-grounded information — never padding or repetition of Slide 2.
- Specific beats vague
- Only ONE highlighted phrase per context slide
- hashtags: EXACTLY 5. Each MUST be a SINGLE word with NO spaces — merge multi-word
  phrases into one CamelCase token (e.g. "student visa" → #StudentVisa, "future of
  work" → #FutureOfWork, "artificial intelligence" → #ArtificialIntelligence).

${correctionBlock}Return ONLY valid JSON. Include a third slide object in "slides" ONLY when Slide 3 is warranted:
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

  const completion = await groq.chat.completions.create({
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
async function generateCarouselSlides(article, topic) {
  let best = null;
  let corrections = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await generateOnce(article, topic, corrections);
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

  console.warn(`[Content] no attempt reached ${QUALITY_TARGET}; using best (${best.quality.score}/100)`);
  return best;
}

module.exports = { generateCarouselSlides, generateOnce, parseModelJson };

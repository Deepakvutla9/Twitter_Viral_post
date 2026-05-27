const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateCarouselSlides(article, topic) {
  const prompt = `You are a viral social media news carousel creator.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 5000)}

Generate EXACTLY 2 slides:

SLIDE 1 — HOOK
- badge: One word category tag. Examples: "NEWS", "BREAKING", "AI UPDATE", "EXCLUSIVE", "ALERT"
- teaser: Short curiosity line ending with →. Example: "What happened? →" or "Here's the truth →"

SLIDE 2 — CONTEXT
- body: 5-6 sentences. Factual, specific, conversational. Include names, numbers, dates. End with a strong concluding statement — no questions.
  IMPORTANT: Wrap the single most important phrase (5-8 words) in **double asterisks** to highlight it. Example: "OpenAI just fired its CTO. **Sam Altman approved the decision personally** despite public denial."

RULES:
- NEVER invent facts
- Specific beats vague
- Body must be 80-100 words
- Only ONE highlighted phrase in body

Return ONLY valid JSON:
{
  "slides": [
    {
      "type": "hook",
      "badge": "NEWS",
      "teaser": "What happened? →"
    },
    {
      "type": "detail",
      "body": "4-5 sentences with **one key phrase highlighted**. End with a question."
    }
  ],
  "imagePrompt": "Cinematic photorealistic scene for this article. NO text, NO logos, NO UI elements. Dramatic lighting, 4k. Max 35 words.",
  "caption": "1-2 hook sentences. Provocative question. New line, EXACTLY 5 relevant hashtags."
}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are a viral Instagram content creator. You always respond with valid JSON only, no markdown, no explanation.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2800,
    response_format: { type: 'json_object' },
  });

  let text = completion.choices[0].message.content.trim()
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Extract JSON object if there's extra text around it
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];

  // Fix common JSON issues: smart quotes, unescaped apostrophes in values
  text = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Last resort: strip control characters and retry
    text = text.replace(/[\x00-\x1F\x7F]/g, (c) => (c === '\n' || c === '\t' ? c : ''));
    parsed = JSON.parse(text);
  }

  // Hard-enforce exactly 2 slides
  const allSlides = parsed.slides || [];
  const hook   = allSlides.find(s => s.type === 'hook')   || allSlides[0];
  const detail = allSlides.find(s => s.type === 'detail') || allSlides[1];

  if (hook)   hook.type   = 'hook';
  if (detail) detail.type = 'detail';

  // Always use the original article title as headline on slide 1
  if (hook) hook.headline = article.title;

  parsed.slides = [hook, detail].filter(Boolean).slice(0, 2);
  return parsed;
}

module.exports = { generateCarouselSlides };

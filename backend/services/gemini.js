const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateCarouselSlides(article, topic) {
  const prompt = `You are a viral Twitter/X carousel creator. You turn tech news into exactly 2 punchy slides.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 5000)}

Generate EXACTLY 2 slides:

SLIDE 1 — THE HOOK (photo card)
- headline: The single most shocking fact. Lead with famous company/person name. Max 10 words. ALL CAPS feel. No punctuation at end.
- subheadline: One punchy sentence that adds context or raises stakes. Max 12 words.

SLIDE 2 — THE DETAIL (text card)
- title: Same headline as slide 1 but with a number prefix, e.g. "1.  HEADLINE HERE"
- label: A short section label like "THE BREAKDOWN:", "KEY FACTS:", "WHY IT MATTERS:", etc.
- body: 3-4 precise sentences. Specific names, numbers, dates. No fluff. Written like a smart friend texting you breaking news. End with a provocative question that makes readers comment.

RULES:
- NEVER invent facts not in the article
- Specific beats vague: "cut 1,200 jobs" not "significant layoffs"
- No corporate jargon
- Body: 60-90 words

Return ONLY valid JSON:
{
  "slides": [
    {
      "type": "hook",
      "headline": "SHOCKING HEADLINE MAX 10 WORDS",
      "subheadline": "One punchy context sentence max 12 words"
    },
    {
      "type": "detail",
      "title": "1.  SHOCKING HEADLINE MAX 10 WORDS",
      "label": "THE BREAKDOWN:",
      "body": "3-4 sentences with specific facts. End with a provocative question."
    }
  ],
  "imagePrompt": "Cinematic photorealistic image prompt for Stable Diffusion. Describe a vivid scene related to the article. NO text, NO logos, NO UI. Example: 'Cinematic wide shot of a futuristic server room glowing blue, dramatic lighting, 4k, hyperrealistic'. Max 40 words.",
  "caption": "Hook sentence. 1-2 sentences context. Provocative question. New line, then EXACTLY 5 relevant hashtags."
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

  // Hard-enforce exactly 2 slides regardless of what the model returns
  const allSlides = parsed.slides || [];
  const hook   = allSlides.find(s => s.type === 'hook')   || allSlides[0];
  const detail = allSlides.find(s => s.type === 'detail') || allSlides[1];

  if (hook)   hook.type   = 'hook';
  if (detail) detail.type = 'detail';

  // Always use the original article title as headline — it's already punchy and credible
  const articleTitle = article.title.toUpperCase();
  if (hook)   hook.headline = articleTitle;
  if (detail) detail.title  = `1.  ${article.title}`;

  parsed.slides = [hook, detail].filter(Boolean).slice(0, 2);
  return parsed;
}

module.exports = { generateCarouselSlides };

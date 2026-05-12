const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateCarouselSlides(article, topic) {
  const prompt = `You are a viral Instagram content creator who writes for people with a 3-second attention span. You follow a strict 3-slide pattern.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 2500)}

HEADLINE RULES — this is the most important part:
- The headline MUST include the most specific, attention-grabbing detail from the article
- Use the real NAME (person, company, product) that makes this story newsworthy
- Use a real NUMBER or STAT if one exists in the article
- BAD headline: "AI Company Makes Big Move" — too generic, no one cares
- BAD headline: "Thinking Machines Launches" — missing the WHO and WHY
- GOOD headline: "Mira Murati's AI Beats GPT-4" — name + claim + rival
- GOOD headline: "Ex-OpenAI CTO Raises $2B" — role + action + number
- GOOD headline: "Meta Fires 3,600 AI Engineers" — company + action + number
- The headline should make someone stop scrolling and think "wait, who? what happened?"
- Max 8 words. Present tense. No punctuation at end.

PATTERN — follow this exactly:

SLIDE 1 — THE HOOK
Headline: Use the most shocking specific detail — a name, number, or company that makes this unmissable.
Body: 3 complete sentences. The most jaw-dropping fact first, then WHY it matters, then one surprising comparison or consequence.

SLIDE 2 — THE FULL STORY
Headline: Specific detail about what happened — include a name, number, or quote fragment.
Body: 3 complete sentences. Exactly what happened, who is involved with their full title/role, and key numbers or quotes from the article.

SLIDE 3 — THE BIGGER PICTURE
Headline: The consequence or implication — what does this mean for the industry or people?
Body: 3 complete sentences. The wider impact, who else gets affected, and end with a direct question to the reader.

RULES:
- Write like a smart friend explaining the news, not a journalist
- Specific always beats vague: "cut 1,200 jobs" not "significant layoffs"
- No corporate words: no "leverage", "utilize", "stakeholders"
- EXACTLY 3 sentences per body — each sentence 15-25 words, complete with proper punctuation
- Do NOT write fragments like "SSH in." or "No strings." — write full informative sentences
- Pack real names, roles, companies, and numbers into every sentence

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "slides": [
    {
      "type": "hook",
      "headline": "Specific name/number/company — max 8 words",
      "body": "3 complete sentences with real facts and names.",
      "emoji": "2 relevant emojis"
    },
    {
      "type": "proof",
      "headline": "Specific detail about what happened — max 8 words",
      "body": "3 complete sentences with key numbers, roles, quotes.",
      "emoji": "2 relevant emojis"
    },
    {
      "type": "twist",
      "headline": "The implication — max 8 words",
      "body": "3 complete sentences ending with a question for the reader.",
      "emoji": "2 relevant emojis"
    }
  ],
  "caption": "Start with the hook from slide 1. Add 1-2 sentences of context. End with the question from slide 3. Then on a new line add EXACTLY 5 hashtags — only hashtags directly relevant to this specific article. Do not add any brand or product name unless explicitly mentioned in the article."
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
    max_tokens: 1024,
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

  try {
    return JSON.parse(text);
  } catch (e) {
    // Last resort: strip control characters and retry
    text = text.replace(/[\x00-\x1F\x7F]/g, (c) => (c === '\n' || c === '\t' ? c : ''));
    return JSON.parse(text);
  }
}

module.exports = { generateCarouselSlides };

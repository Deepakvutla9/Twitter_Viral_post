const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateCarouselSlides(article, topic) {
  const prompt = `You are a viral Instagram content creator who writes for people with a 3-second attention span. You follow a strict 3-slide pattern.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 2500)}

PATTERN — follow this exactly:

SLIDE 1 — THE HOOK
Start with the single most shocking or surprising fact from this story.
Then give 3-4 sentences of real context so the reader understands WHY it's a big deal.
Use specific numbers, names, comparisons. Make it impossible to swipe away.
This slide should make someone think "wait, seriously?" and want to read more.

SLIDE 2 — THE FULL STORY
This is where you deliver the real value. Write 4-5 sentences covering:
- What exactly happened and who is involved
- The key numbers, facts, or quotes that make this real
- Any background context the reader needs to fully understand the situation
- What triggered this or why it's happening now
Readers should feel informed after this slide, not teased.

SLIDE 3 — THE BIGGER PICTURE
Zoom out and tell the reader what this means for them and the world.
Write 4-5 sentences covering:
- The wider implication or consequence of this story
- Who else is affected and how
- What might happen next
- End with a direct question to the reader that makes them think or want to comment

RULES:
- Write like a smart friend explaining the news, not a journalist or press release
- Specific always beats vague: "cut 1,200 jobs" not "significant layoffs"
- No corporate words: no "leverage", "utilize", "in conclusion", "stakeholders"
- Write EXACTLY 3 sentences per slide body — no more, no less
- Each sentence must be complete — always end with a period, exclamation mark, or question mark
- Each sentence should be meaty and informative, around 15-25 words
- Do NOT write one-word or two-word sentences like "SSH in." or "No strings."
- Pack real facts, names, and numbers into every sentence

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "slides": [
    {
      "type": "hook",
      "headline": "One punchy line, max 8 words, present tense",
      "body": "1-2 sentences. The most shocking fact. Zero context needed.",
      "emoji": "2 relevant emojis"
    },
    {
      "type": "proof",
      "headline": "Here Is The Proof",
      "body": "2-3 sentences. Hard facts, numbers, names that back up slide 1.",
      "emoji": "2 relevant emojis"
    },
    {
      "type": "twist",
      "headline": "Nobody Is Talking About This",
      "body": "1-2 sentences. The implication or twist. End with a question for the reader.",
      "emoji": "2 relevant emojis"
    }
  ],
  "caption": "Start with the hook from slide 1. Add 1-2 sentences of context. End with the question from slide 3. Then on a new line add EXACTLY 5 hashtags. Rules for hashtags: only use hashtags that are directly relevant to this specific article. Do not add any brand, company, or product name unless it is explicitly mentioned in the article. Make them viral and specific to the story — think about what someone would search to find this exact news."
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

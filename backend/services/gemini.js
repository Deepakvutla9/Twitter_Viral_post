const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateCarouselSlides(article, topic) {
  const prompt = `You are a viral Instagram content creator who writes for people with a 3-second attention span. You follow a strict 3-slide pattern.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 4000)}

HEADLINE RULES — this is the most important part:
- Always lead with the FAMOUS BRAND or COMPANY NAME first, then the person or action
- Most people don't know executive names — they know company names. Use both.
- Formula: "[Famous Company] [Action] [Shocking Detail]"
- BAD: "Roslansky Steps Down" — nobody knows who Roslansky is
- GOOD: "LinkedIn CEO Steps Down After 6 Years" — company first, context included
- BAD: "AI Company Makes Big Move" — too generic
- BAD: "Thinking Machines Launches" — missing the famous context
- GOOD: "Ex-OpenAI CTO Mira Murati Raises $2B" — role + famous org + name + number
- GOOD: "Meta Fires 3,600 AI Engineers" — famous company + action + number
- GOOD: "Google Gemini Beats GPT-4 on Every Benchmark" — brand + rival + claim
- If a person is mentioned, also include their ROLE or COMPANY so readers know why they matter
- Max 9 words. Present tense. No punctuation at end.

PATTERN — follow this exactly:

SLIDE 1 — THE HOOK
Headline: Famous company name first, then the shocking action — max 9 words.
Body: 4 meaty sentences. Open with the single most jaw-dropping fact with exact numbers or names. Then explain WHY this is shocking compared to what people expected. Add a surprising backstory or little-known context that makes this even bigger. End with the most dramatic consequence or detail from the article.

SLIDE 2 — THE FULL STORY
Headline: What specifically happened — company + action + detail, max 9 words.
Body: 4 meaty sentences. Explain exactly who did what and when, including full titles and roles. Include the most interesting quote, internal conflict, or behind-the-scenes detail. Add key numbers — revenue, headcount, timeline, salary, valuation — whatever makes this concrete. Give the "why now" — what triggered this and what it took to get here.

SLIDE 3 — THE BIGGER PICTURE
Headline: The consequence — what this means for the industry, max 9 words.
Body: 4 meaty sentences. Explain the ripple effect on workers, competitors, or users. Add one detail that will genuinely surprise or concern the reader. Connect it to a bigger trend in AI or tech that's already happening. End with a provocative question that makes people want to drop their opinion in the comments.

RULES:
- Write like a smart friend explaining the news, not a journalist
- Specific always beats vague: "cut 1,200 jobs" not "significant layoffs"
- No corporate words: no "leverage", "utilize", "stakeholders"
- EXACTLY 4 sentences per body — each sentence 20-30 words, complete with proper punctuation
- Do NOT write fragments — write full, rich, informative sentences packed with detail
- Every sentence must contain at least one specific fact: a name, number, date, role, or quote
- Find the most interesting, surprising, or controversial detail in the article and make sure it appears
- If the article mentions a rivalry, betrayal, record number, salary, or controversial decision — that goes in the body
- Sentences should flow naturally and build on each other like a story, not feel like a list of facts
- NEVER invent facts, numbers, or company names not explicitly stated in the article
- If the article does not mention a specific number, do not make one up
- NEVER write vague filler sentences like "Experts predict change is coming" or "This will impact many people" — if you don't have a specific fact, use a different fact from the article
- Each sentence must answer WHO, WHAT, or HOW MUCH — vague sentences with no specifics are forbidden
- If the article is a community discussion (Reddit, forum), focus on the most specific claims, quotes, or data points mentioned by commenters

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "slides": [
    {
      "type": "hook",
      "headline": "Specific name/number/company — max 8 words",
      "body": "4 complete sentences with real facts, names, numbers.",
      "emoji": "2 relevant emojis"
    },
    {
      "type": "proof",
      "headline": "Specific detail about what happened — max 8 words",
      "body": "4 complete sentences with key numbers, roles, quotes.",
      "emoji": "2 relevant emojis"
    },
    {
      "type": "twist",
      "headline": "The implication — max 8 words",
      "body": "4 complete sentences ending with a provocative question.",
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
    max_tokens: 1800,
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

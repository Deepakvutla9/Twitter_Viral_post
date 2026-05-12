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

PATTERN — follow this exactly. Write like a Netflix narrator telling a true crime story — gripping, conversational, specific:

SLIDE 1 — THE HOOK
Headline: Famous company name first, then the shocking action — max 9 words.
Body: A flowing 3-4 sentence narrative paragraph. Open mid-story with the single most jaw-dropping fact — a number, a name, a decision that shocks. Pull the reader in like you're telling a friend something they won't believe. End with a cliffhanger line that makes them NEED to swipe — something like "But nobody saw what came next." or "And that was just the start."

SLIDE 2 — THE FULL STORY
Headline: What specifically happened — company + action + detail, max 9 words.
Body: A flowing 3-4 sentence narrative paragraph. Continue the story from slide 1 — who did what, when, and why. Include the most dramatic behind-the-scenes detail, quote, internal conflict, or surprising timeline. Build tension. End with a transition that raises the stakes — something like "But here's where it gets really interesting." or "Then the numbers came out — and they were worse than anyone expected."

SLIDE 3 — THE TWIST
Headline: The consequence — what this means for the industry, max 9 words.
Body: A flowing 3-4 sentence narrative paragraph. Land the twist — the ripple effect nobody's talking about. Connect it to something bigger already happening in AI or tech. Make the reader feel like they just learned something most people don't know. End with a punchy question that makes them want to drop their opinion in the comments — something provocative and direct.

RULES:
- Write like a Netflix narrator or a smart friend texting you breaking news — NOT a journalist, NOT a press release
- Each body is ONE flowing paragraph, not bullet points or separate lines
- Specific always beats vague: "cut 1,200 jobs" not "significant layoffs"
- No corporate words: no "leverage", "utilize", "stakeholders", "paradigm"
- Each slide body is 3-4 sentences, 80-120 words total, flowing and conversational
- Every sentence must contain at least one specific fact: a name, number, date, role, or quote
- The cliffhanger at the end of slide 1 and slide 2 must feel natural, not forced
- Find the most interesting, surprising, or controversial detail in the article and lead with it
- If the article mentions a rivalry, betrayal, record number, salary, or controversial decision — that goes in the body
- NEVER invent facts, numbers, or company names not explicitly stated in the article
- If the article does not mention a specific number, do not make one up
- NEVER write vague filler sentences like "Experts predict change is coming" or "This will impact many people"
- Each sentence must answer WHO, WHAT, or HOW MUCH — vague sentences with no specifics are forbidden

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

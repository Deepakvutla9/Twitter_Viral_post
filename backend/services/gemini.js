const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateCarouselSlides(article, topic) {
  const prompt = `You are a viral Instagram carousel storyteller. You turn tech news into gripping multi-slide stories that people can't stop swiping through.

Article Title: ${article.title}
Source: ${article.source}
Content: ${article.fullText.slice(0, 5000)}

HEADLINE RULES — most important:
- Always lead with the FAMOUS BRAND or COMPANY NAME first, then the person or action
- Formula: "[Famous Company] [Action] [Shocking Detail]"
- BAD: "Roslansky Steps Down" → GOOD: "LinkedIn CEO Steps Down After 6 Years"
- BAD: "AI Company Makes Big Move" → GOOD: "Ex-OpenAI CTO Mira Murati Raises $2B"
- GOOD: "Meta Fires 3,600 AI Engineers" / "Google Gemini Beats GPT-4 on Every Benchmark"
- Include role + company name so readers know why the person matters
- Max 9 words. Present tense. No punctuation at end.

SLIDE COUNT — decide based on story richness:
- Simple story (1 main fact): 3 slides
- Medium story (backstory + consequences): 4 slides
- Rich story (multiple angles, rivalries, numbers, quotes): 5 slides
- Complex story (full arc with context, drama, industry impact): 6 slides
- NEVER exceed 6 slides. NEVER pad with fluff to reach a higher count.

SLIDE STRUCTURE — write like a Netflix narrator, gripping and conversational:

SLIDE 1 — THE HOOK
Headline: Famous company + shocking action, max 9 words.
Body: 3-4 sentences. Open with the single most jaw-dropping fact. Make the reader feel like they just heard something they shouldn't know yet. End with a cliffhanger — "But nobody saw what came next." / "And that was just the beginning."

SLIDE 2 — THE BACKSTORY
Headline: How did we get here — context, max 9 words.
Body: 3-4 sentences. Zoom out — what was the situation BEFORE this happened? Include timeline, prior decisions, or the buildup that made this moment inevitable. End by snapping back to the present with rising tension.

SLIDE 3 — THE DETAILS (always include)
Headline: The specific what/who/how much, max 9 words.
Body: 3-4 sentences. The concrete facts — numbers, names, roles, quotes, dates. The stuff that makes this real. End with a line that raises the stakes: "But here's where it gets really interesting." / "Then the real numbers came out."

SLIDE 4 — THE CONFLICT (include if story has rivalry, reaction, or drama)
Headline: The tension — who's affected or fighting back, max 9 words.
Body: 3-4 sentences. Who's reacting? What's the internal conflict or public response? Include any surprising quote, counter-move, or unexpected player in the story. End with another push forward.

SLIDE 5 — THE BIGGER PICTURE (include if story connects to a major trend)
Headline: What this signals for the industry, max 9 words.
Body: 3-4 sentences. Zoom out to the industry trend. What does this mean for workers, competitors, or the future of AI? Make the reader feel like they're seeing something most people haven't connected yet.

SLIDE 6 — THE TWIST / FINAL TAKE (always the last slide)
Headline: The consequence or provocative takeaway, max 9 words.
Body: 3-4 sentences. Land the gut-punch conclusion. The thing that will make people screenshot this. End with ONE punchy question that makes them drop their opinion in the comments — direct, provocative, impossible to ignore.

RULES:
- Write like a smart friend texting you breaking news — NOT a journalist, NOT a press release
- Each body is ONE flowing paragraph — no bullet points, no line breaks inside body
- Specific always beats vague: "cut 1,200 jobs" not "significant layoffs"
- No corporate jargon: no "leverage", "utilize", "stakeholders", "paradigm", "ecosystem"
- Each slide body: 3-4 sentences, 70-110 words, conversational and flowing
- Every sentence must contain at least one specific fact: name, number, date, role, or quote
- Cliffhangers between slides must feel natural — not "Stay tuned!" or "Swipe to find out!"
- NEVER invent facts, numbers, quotes, or names not in the article
- NEVER write vague filler like "experts say change is coming" or "this will impact many people"
- If a detail is missing from the article, skip it — don't fill in with guesses

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "slides": [
    {
      "type": "hook",
      "headline": "Company + action — max 9 words",
      "body": "Flowing narrative paragraph, 3-4 sentences, ends with cliffhanger.",
      "emoji": "2 relevant emojis"
    }
    ... (3 to 6 slides total depending on story richness)
  ],
  "caption": "Hook sentence from slide 1. 1-2 sentences of context. End with the question from the last slide. New line, then EXACTLY 5 hashtags directly relevant to this article only."
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

  try {
    return JSON.parse(text);
  } catch (e) {
    // Last resort: strip control characters and retry
    text = text.replace(/[\x00-\x1F\x7F]/g, (c) => (c === '\n' || c === '\t' ? c : ''));
    return JSON.parse(text);
  }
}

module.exports = { generateCarouselSlides };

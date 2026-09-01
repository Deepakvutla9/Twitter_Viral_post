// ── WHAT THIS FILTER IS FOR ──────────────────────────────────────────────────
//
// An account whose tech slots should carry AI news and nothing else. The tech
// pool it draws from is deliberately broad — the HN front page, general feeds
// from The Verge, Wired, BBC Tech — so without a gate a "tech" slot publishes
// whatever was popular that hour: a phone launch, a browser release, a company
// nobody asked about.
//
// Five subjects count as AI here:
//
//   labs      — who builds it: OpenAI/ChatGPT, Anthropic/Claude, Google/Gemini,
//               Meta, Mistral, DeepSeek, xAI, and the rest
//   models    — the technology itself: LLMs, training, inference, benchmarks
//   agents    — software that acts: agents, copilots, chatbots, assistants
//   robots    — AI with a body: humanoids, Optimus, Figure, Boston Dynamics
//   jobs      — what it does to work: displacement, automation, AI layoffs
//
// ── HOW A STORY IS ADMITTED ──────────────────────────────────────────────────
//
// Same approach as the visa gate, for the same reason: a plain keyword list
// only holds the phrasings someone thought of, and AI coverage renames itself
// every few months.
//
// The hard part here is the opposite of the visa pool's. "AI" is stamped on
// everything now — every product launch, every funding round, every phone. A
// gate that admits on the word alone admits the whole tech pool right back in,
// which is the problem it exists to solve. So a named lab or the technology's
// own vocabulary admits outright, and the vaguer signals must corroborate each
// other before they mean anything.

const LAB_SIGNAL = new RegExp([
  '\\bopenai\\b', '\\bchat\\s?gpt\\b', '\\bgpt-?\\d', '\\bsora\\b', '\\bdall-?e\\b',
  '\\banthropic\\b', '\\bclaude\\b',
  '\\bgemini\\b', '\\bdeepmind\\b', '\\bgoogle ai\\b', '\\bbard\\b',
  '\\bmistral\\b', '\\bdeepseek\\b', '\\bcohere\\b', '\\bperplexity\\b',
  '\\bx\\.?ai\\b', '\\bgrok\\b', '\\bllama\\b', '\\bhugging\\s?face\\b',
  '\\bmidjourney\\b', '\\bstability ai\\b', '\\bstable diffusion\\b',
  '\\bcopilot\\b', '\\bnvidia\\b', '\\bscale ai\\b', '\\bsafe superintelligence\\b',
].join('|'), 'i');

// The vocabulary of the technology itself. These words are not used about
// anything else, so one of them is enough.
const MODEL_SIGNAL = new RegExp([
  '\\bllms?\\b', '\\blarge language models?\\b', '\\bfoundation models?\\b',
  '\\bfrontier models?\\b', '\\bgenerative ai\\b', '\\bgen ?ai\\b',
  '\\bmachine learning\\b', '\\bdeep learning\\b', '\\bneural networks?\\b',
  '\\bdiffusion models?\\b', '\\bfine-?tun(?:e|ed|ing)\\b',
  '\\bprompt engineering\\b', '\\bhallucinat(?:e|es|ed|ion|ions)\\b',
  '\\btraining run\\b', '\\bagi\\b', '\\bsuperintelligence\\b',
  '\\bai (?:safety|alignment|regulation|model|models|research|lab|labs)\\b',
  '\\bmultimodal\\b', '\\bopen-?weights?\\b',
].join('|'), 'i');

// Software that acts on its own. "Agent" and "assistant" have ordinary lives
// too, so these only count next to something that makes them software.
const AGENT_SIGNAL = /\b(ai agents?|agentic|autonomous agents?|chat ?bots?|ai assistants?|coding assistants?|voice assistants?|ai models?|ai tools?|ai systems?|ai chatbots?)\b/i;

const ROBOT_SIGNAL = /\b(robots?|robotics|robotic|humanoids?|optimus|boston dynamics|figure ai|unitree|self-?driving|autonomous vehicles?|waymo)\b/i;

// What it does to work. This is the bucket the account cares about most, and
// the one most often written without the word "AI" in the headline.
const JOBS_SIGNAL = new RegExp([
  'job (?:losses|cuts|displacement)',
  // "cuts 14,000 corporate jobs" — the shape most layoff headlines actually
  // take. Matching only "job cuts" missed the ones that name a number, which
  // are the bigger stories.
  'cut(?:s|ting)?\s+[\d,]+\s+(?:[a-z-]+\s+){0,2}(?:jobs|roles|positions|staff)',
  '(?:slash|eliminat|axe)(?:e|es|ed|ing)?\s+(?:[\d,]+\s+)?(?:jobs|roles|positions)',
  'jobs? (?:market|apocalypse)',
  'layoffs?', 'laid off', 'redundanc(?:y|ies)',
  'replac(?:e|ed|ing) (?:workers|jobs|staff|employees|humans)',
  'automat(?:e|ed|ing|ion) (?:jobs|work|workers|roles)',
  '(?:takes|taking|took) over (?:the )?(?:jobs|work|roles|scheduling|support)',
  'white-?collar', 'entry-?level (?:jobs|roles|hiring)',
  'hiring freeze', 'reskilling',
].join('|'), 'i');

// The bare word. Real evidence, but far too common on its own — every product
// on earth is "AI-powered" now, so this admits nothing by itself.
const WEAK_AI_SIGNAL = /\b(a\.?i\.?|artificial intelligence|algorithms?|automation|chips?|gpus?|data ?centers?|compute)\b/i;

// Subjects that carry AI vocabulary but are not AI news for this audience:
// crypto, gadget reviews, gaming, and the endless phone cycle.
const OFF_TOPIC_SIGNAL = /\b(crypto|bitcoin|ethereum|nft|blockchain|web3|token sale|iphone \d|galaxy s\d{2}|pixel \d|headphones?|earbuds?|smartwatch|console|playstation|xbox|nintendo|netflix|streaming service)\b/i;

const BUCKETS = {
  labs: { test: LAB_SIGNAL, weight: 30 },
  models: { test: MODEL_SIGNAL, weight: 26 },
  agents: { test: AGENT_SIGNAL, weight: 20 },
  robots: { test: ROBOT_SIGNAL, weight: 24 },
  jobs: { test: JOBS_SIGNAL, weight: 22 },
};

function hayOf(item) {
  return `${item?.title || ''} ${item?.summary || ''}`.toLowerCase();
}

function matchBuckets(hay) {
  const hit = {};
  for (const [name, { test, weight }] of Object.entries(BUCKETS)) {
    if (test.test(hay)) hit[name] = { weight };
  }
  return hit;
}

/**
 * Admit or reject, with the reasons written down.
 *
 * Returned rather than logged so the caller can say why a pool came up empty.
 * A gate that silently drops everything is indistinguishable from feeds being
 * down, and this codebase has already paid for that once.
 */
function assess(item) {
  const hay = hayOf(item);
  const title = String(item?.title || '').toLowerCase();
  const buckets = matchBuckets(hay);
  const reasons = Object.keys(buckets).map((n) => `bucket:${n}`);

  // A named lab beats the off-topic list: "OpenAI buys a chip startup" is AI
  // news even though chips are gadgets, while "best AI earbuds" is not.
  if (LAB_SIGNAL.test(hay)) {
    reasons.push('lab-named');
    return { admit: true, reasons, buckets };
  }

  if (OFF_TOPIC_SIGNAL.test(hay)) {
    reasons.push('off-topic');
    return { admit: false, reasons, buckets };
  }

  // The technology by name, or a robot, is enough on its own.
  if (MODEL_SIGNAL.test(hay) || ROBOT_SIGNAL.test(hay)) {
    reasons.push('subject-named');
    return { admit: true, reasons, buckets };
  }

  // Work stories have to be about work *and* about AI. "Layoffs at a retailer"
  // is not this account's subject; "AI is taking entry-level jobs" is.
  if (JOBS_SIGNAL.test(hay)) {
    if (AGENT_SIGNAL.test(hay) || WEAK_AI_SIGNAL.test(hay)) {
      reasons.push('jobs+ai');
      return { admit: true, reasons, buckets };
    }
    reasons.push('jobs-without-ai');
    return { admit: false, reasons, buckets };
  }

  // An agent phrase in the headline is specific enough. Buried in a summary it
  // is usually a passing mention of somebody else's product.
  if (AGENT_SIGNAL.test(title)) {
    reasons.push('agent-in-title');
    return { admit: true, reasons, buckets };
  }

  return { admit: false, reasons: reasons.length ? reasons : ['no-ai-signal'], buckets };
}

function isAiStory(item) {
  return assess(item).admit;
}

// What makes an AI story worth the slot rather than merely on topic. Something
// shipped, something was measured, someone was replaced — these beat commentary
// about the same subject.
const IMPACT_TERMS = [
  ['launches', 12], ['launched', 12], ['releases', 12], ['released', 12],
  ['announces', 10], ['announced', 10], ['unveils', 10], ['open-sources', 12],
  ['acquires', 12], ['acquisition', 12], ['raises', 10], ['funding', 8],
  ['lawsuit', 10], ['sues', 10], ['bans', 12], ['banned', 12], ['regulation', 10],
  ['outperforms', 10], ['benchmark', 10], ['study finds', 12],
  ['report finds', 12], ['data shows', 10], ['cuts jobs', 14], ['replaces', 12],
];

// Commentary and shopping copy are real coverage but not news, and a pool that
// ranks them first reads like a blog roll.
const SOFT_TERMS = [
  ['opinion', 10], ['op-ed', 10], ['thinks', 8], ['believes', 8],
  ['what to know', 8], ['explained', 6], ['best ', 10], ['top 10', 12],
  ['review', 10], ['hands-on', 10], ['deals', 12], ['how to ', 8],
];

function sumTerms(hay, terms, cap) {
  let total = 0;
  for (const [term, weight] of terms) if (hay.includes(term)) total += weight;
  return Math.min(total, cap);
}

/**
 * Rank within the pool: which subject, whether anything actually happened, and
 * how fresh it is.
 *
 * Bucket weights add up on purpose — a story about a lab shipping an agent that
 * displaces work is more on-subject than one that is only about a lab, and it
 * should rank that way.
 */
function scoreAiStory(item) {
  const title = String(item?.title || '');
  const hay = hayOf(item);

  let score = 0;
  for (const { weight } of Object.values(matchBuckets(hay))) score += weight;

  // The title is what the post is about; the summary trails feed furniture.
  if (LAB_SIGNAL.test(title)) score += 16;
  if (JOBS_SIGNAL.test(title)) score += 14;
  if (ROBOT_SIGNAL.test(title)) score += 10;

  score += sumTerms(hay, IMPACT_TERMS, 40);
  score -= sumTerms(hay, SOFT_TERMS, 30);
  if (OFF_TOPIC_SIGNAL.test(hay)) score -= 25;

  // AI news dates fast — a model release is stale in two days.
  const ageHours = (Date.now() - new Date(item?.pubDate).getTime()) / 3600000;
  if (Number.isFinite(ageHours)) score += Math.max(0, 36 - ageHours);

  // Carried through from the feed so an on-topic story the wider internet also
  // cared about wins ties.
  score += Math.min(20, Number(item?.hnPoints || 0) / 25);

  return Math.round(score);
}

module.exports = {
  BUCKETS, LAB_SIGNAL, MODEL_SIGNAL, AGENT_SIGNAL, ROBOT_SIGNAL, JOBS_SIGNAL,
  OFF_TOPIC_SIGNAL, WEAK_AI_SIGNAL, matchBuckets, assess, isAiStory, scoreAiStory,
};

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
  'cut(?:s|ting)?\\s+[\\d,]+\\s+(?:[a-z-]+\\s+){0,2}(?:jobs|roles|positions|staff)',
  '(?:slash|eliminat|axe)(?:e|es|ed|ing)?\\s+(?:[\\d,]+\\s+)?(?:jobs|roles|positions)',
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

// Subjects that carry AI or startup vocabulary but are not this account's news:
// crypto and speculation, gadget reviews, gaming, and the endless phone cycle.
//
// The speculation group is here because of the funding bucket, not the AI one.
// "Raises $300 million" reads as a startup success story whatever the company
// does, so a prediction market or a betting app clears the second tier on the
// money alone. Naming the business excludes it; a company that merely takes
// investment from a fund is untouched.
const OFF_TOPIC_SIGNAL = new RegExp(
  [
    /\b(?:crypto|bitcoin|ethereum|nft|blockchain|web3|token sale|stablecoins?|memecoins?)\b/,
    /\b(?:prediction markets?|polymarket|kalshi|sports ?book|betting|gambling|casino|meme stocks?|day trading|forex)\b/,
    /\b(?:iphone \d|galaxy s\d{2}|pixel \d|headphones?|earbuds?|smartwatch)\b/,
    /\b(?:console|playstation|xbox|nintendo|netflix|streaming service)\b/,
  ].map((r) => r.source).join('|'),
  'i',
);

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

// ── SECOND TIER: WHAT TO POST WHEN THE AI POOL IS EMPTY ──────────────────────
//
// AI news does not arrive on a six-hour cadence. Some slots there is genuinely
// nothing, and the choice is between missing the post and widening the subject.
//
// These three subjects widen it without changing what the account is about. A
// reader who came for AI news is the same reader who wants a tool worth trying,
// a course worth taking, or a company worth watching. General tech — a phone
// launch, a console bundle — is still out, which is the whole point.

// Written as regex literals rather than assembled from strings. The first tier
// uses strings because those lists are long enough to want line breaks; here
// the escaping is the whole risk, and a literal has no escaping layer to get
// wrong.

// Something built, that a reader could go and use.
const TOOL_SIGNAL = new RegExp(
  [
    /\b(?:launch(?:es|ed)?|releases?|ships?|unveils?|introduc(?:es|ed)|debuts?|rolls? out)\b(?:\s+\S+){0,4}?\s+\b(?:tool|tools|app|apps|platform|extension|plugin|api|sdk|framework|library|service)\b/,
    /\b(?:new|free|open-?source)\s+(?:\S+\s+){0,2}(?:tool|tools|app|apps|platform|editor|assistant|generator|tracker|dashboard)\b/,
    /\bno-?code\b/, /\bproduct hunt\b/, /\bopen-?sourc(?:e|es|ed|ing)\b/,
    /\bpublic beta\b/, /\bnow available\b/, /\bgeneral availability\b/,
  ].map((r) => r.source).join('|'),
  'i',
);

// Something to learn, and where. This is the account's own audience — people
// studying, or deciding what to study.
const COURSE_SIGNAL = new RegExp(
  [
    /\bcourses?\b/, /\bcertificat(?:e|es|ion|ions)\b/, /\bcurricul(?:um|a)\b/,
    /\bbootcamps?\b/, /\bmoocs?\b/, /\bcoursera\b/, /\bed-?x\b/,
    /\budemy\b/, /\bkhan academy\b/, /\bnanodegree\b/,
    /\bscholarships?\b/, /\bfellowships?\b/, /\bupskilling\b/,
    /\btraining programs?\b/, /\bfree (?:to learn|training|classes)\b/,
    /\blearn(?:ing)? (?:to code|programming|python|data science|ai|machine learning)\b/,
  ].map((r) => r.source).join('|'),
  'i',
);

// A company that made it, or is visibly on the way. Money raised, a founder
// story, an exit — the shape of a success rather than an announcement.
const STARTUP_SIGNAL = new RegExp(
  [
    /\bstart-?ups?\b/, /\bfounders?\b/, /\bco-?founders?\b/,
    /\bseed round\b/, /\bseries [a-f]\b/, /\bpre-?seed\b/,
    /\braises? \$?[\d.]+\s?(?:m|b|million|billion|crore)\b/,
    /\bvaluation\b/, /\bunicorns?\b/, /\by ?combinator\b/, /\byc [ws]\d{2}\b/,
    /\bbootstrapped\b/, /\bacqui(?:red|sition|hire)\b/,
    /\bipo\b/, /\bfrom zero to\b/,
  ].map((r) => r.source).join('|'),
  'i',
);

// The Mac specifically, not Apple generally. An iPhone camera or a Watch band
// is the gadget churn this account is filtering out; the machine its readers
// work on is not. Apple silicon counts because that is what Mac news is mostly
// about now, and because it is where Apple's AI story actually lands.
const MAC_SIGNAL = new RegExp(
  [
    /\bmac(?:book|books)?\b/, /\bmac (?:mini|studio|pro)\b/, /\bimac\b/,
    /\bmac ?os\b/, /\bapple silicon\b/, /\bm[1-9]\s?(?:pro|max|ultra|chip)\b/,
    /\bapple (?:intelligence|vision pro)\b/,
  ].map((r) => r.source).join('|'),
  'i',
);

const SECOND_TIER = {
  tools: { test: TOOL_SIGNAL, weight: 20 },
  courses: { test: COURSE_SIGNAL, weight: 24 },
  startups: { test: STARTUP_SIGNAL, weight: 22 },
  mac: { test: MAC_SIGNAL, weight: 20 },
};

/**
 * The second tier's own gate. Same off-topic list as the first — a gadget review
 * is not a "new tool", and a console launch is not a startup story.
 */
function assessSecondary(item) {
  const hay = hayOf(item);
  const hit = [];
  for (const [name, { test }] of Object.entries(SECOND_TIER)) {
    if (test.test(hay)) hit.push(name);
  }
  if (!hit.length) return { admit: false, reasons: ['no-second-tier-signal'], buckets: {} };
  if (OFF_TOPIC_SIGNAL.test(hay)) {
    return { admit: false, reasons: ['off-topic', ...hit.map((n) => `tier2:${n}`)], buckets: {} };
  }
  return { admit: true, reasons: hit.map((n) => `tier2:${n}`), buckets: {} };
}

function isSecondaryStory(item) {
  return assessSecondary(item).admit;
}

function scoreSecondaryStory(item) {
  const hay = hayOf(item);
  let score = 0;
  for (const [, { test, weight }] of Object.entries(SECOND_TIER)) {
    if (test.test(hay)) score += weight;
  }
  score += sumTerms(hay, IMPACT_TERMS, 30);
  score -= sumTerms(hay, SOFT_TERMS, 30);
  if (OFF_TOPIC_SIGNAL.test(hay)) score -= 25;

  const ageHours = (Date.now() - new Date(item?.pubDate).getTime()) / 3600000;
  if (Number.isFinite(ageHours)) score += Math.max(0, 36 - ageHours);
  score += Math.min(20, Number(item?.hnPoints || 0) / 25);
  return Math.round(score);
}

module.exports = {
  BUCKETS, LAB_SIGNAL, MODEL_SIGNAL, AGENT_SIGNAL, ROBOT_SIGNAL, JOBS_SIGNAL,
  OFF_TOPIC_SIGNAL, WEAK_AI_SIGNAL, matchBuckets, assess, isAiStory, scoreAiStory,
  TOOL_SIGNAL, COURSE_SIGNAL, STARTUP_SIGNAL, MAC_SIGNAL, SECOND_TIER,
  assessSecondary, isSecondaryStory, scoreSecondaryStory,
};

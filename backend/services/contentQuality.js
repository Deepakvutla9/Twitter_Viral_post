const DEFAULT_BADGE = 'NEWS';
const ALLOWED_BADGES = new Set(['NEWS', 'BREAKING', 'AI UPDATE', 'EXCLUSIVE', 'ALERT']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function countWords(value) {
  const words = cleanText(value).match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g);
  return words ? words.length : 0;
}

function countHighlights(value) {
  const matches = cleanText(value).match(/\*\*[^*][\s\S]*?[^*]\*\*/g);
  return matches ? matches.length : 0;
}

function extractHashtags(value) {
  const matches = cleanText(value).match(/(^|\s)#[A-Za-z0-9_]+/g);
  return matches ? matches.map((tag) => tag.trim()) : [];
}

// Curated Instagram hashtag pool for tech posts. Every carousel posts 5 —
// matched against the story's own copy, not model-invented — since Instagram
// now favours a small, consistent, relevant set. Edit this list to change the
// hashtags in circulation. Pure engagement bait (#instagood, #bhfyp, #love)
// used to live here; it never described a single post and Instagram reads it as
// spam, so it is gone. Art tags stay but are match-only (see MATCH_ONLY).
const HASHTAG_POOL = [
  '#technology', '#tech', '#innovation', '#business', '#iphone', '#engineering',
  '#technews', '#science', '#software', '#gadgets', '#design', '#electronics',
  '#apple', '#programming', '#android', '#coding', '#ai', '#samsung',
  '#smartphone', '#security', '#cybersecurity', '#education', '#computer',
  '#marketing', '#technologynews',
  '#artificialintelligence', '#instatech', '#digital', '#future',
  '#startup', '#mobile', '#techno', '#gadget', '#india', '#automation', '#it',
  '#computerscience', '#programmer', '#internet', '#entrepreneur', '#developer',
  '#techie', '#tecnologia', '#engineer', '#robotics', '#data',
  '#python', '#iot', '#digitalmarketing', '#oneplus', '#gaming',
  '#machinelearning', '#aiart', '#digitalart', '#aiartcommunity', '#midjourney',
  '#datascience', '#generativeart', '#deeplearning', '#midjourneyart',
  '#aiartist', '#aiartwork', '#bigdata', '#aiartists',
  '#digitalartist', '#midjourneyai', '#chatgpt', '#stablediffusion',
  '#digitaltransformation', '#neuralnetworks', '#dataanalytics',
  '#dalle', '#nft', '#robot', '#aigenerated', '#midjourneyartwork',
  '#analytics', '#datascientist', '#aigeneratedart',
];

// Visa/immigration posts need their own tags — the tech pool above would put
// #midjourney and #python on an H-1B post, which reads as spam and reaches the
// wrong audience entirely.
const VISA_HASHTAG_POOL = [
  // visa / immigration status
  '#h1b', '#h1bvisa', '#h4visa', '#visa', '#visanews', '#visaupdate',
  '#immigration', '#immigrationnews', '#immigrationupdate', '#greencard',
  '#greencardholder', '#uscis', '#permanentresidency', '#workvisa',
  '#usimmigration', '#immigrants', '#visaapplication', '#visainterview',
  '#employmentbasedvisa', '#travelvisa', '#consulate', '#studyvisa',
  // students
  '#studentvisa', '#f1visa', '#opt', '#stemopt', '#internationalstudents',
  '#internationalstudent', '#internationaleducation', '#studyabroad',
  '#studyabroadlife', '#studyoverseas', '#overseaseducation', '#educationabroad',
  '#abroadstudies', '#highereducation', '#university', '#college', '#education',
  '#student', '#students', '#studentlife', '#study', '#ielts', '#classof2026',
  // destinations
  '#studyinusa', '#studyincanada', '#studyinuk', '#studyinaustralia',
  '#canadaimmigration', '#ukvisa', '#australiavisa', '#canada', '#uk',
  '#australia', '#overseas',
  // audience
  '#indianstudents', '#indiansabroad', '#indiansinusa', '#nri', '#desiabroad',
  '#travel',
];

const POLITICS_HASHTAG_POOL = [
  '#trump', '#donaldtrump', '#politics', '#uspolitics', '#politicalnews',
  '#breakingnews', '#news', '#usnews', '#whitehouse', '#washington',
  '#government', '#congress', '#senate', '#supremecourt', '#election',
  '#democracy', '#policy', '#economy', '#tariffs', '#trade', '#foreignpolicy',
  '#worldnews', '#geopolitics', '#america', '#usa', '#republicans',
  '#democrats', '#currentevents', '#headlines', '#breaking', '#potus',
  '#executiveorder', '#lawandpolitics', '#nationalnews',
];
const HASHTAG_POOLS = { visa: VISA_HASHTAG_POOL, politics: POLITICS_HASHTAG_POOL };

// Evergreen tags that are true of any post in their pool. They fill the slots a
// story does not earn on its own.
const ANCHOR_TAGS = {
  tech: ['#technology', '#tech', '#technews', '#technologynews', '#innovation', '#future', '#digital'],
  visa: ['#visa', '#visanews', '#visaupdate', '#immigration', '#immigrationnews'],
  politics: ['#news', '#usnews', '#politics', '#politicalnews', '#currentevents', '#headlines'],
};

// Tags that are only ever right when the story is genuinely about them. They
// stay in the pools so an image-model story can still reach that audience, but
// random filler must never drop #midjourney or #iphone on an obituary.
const MATCH_ONLY = new Set([
  '#aiart', '#digitalart', '#aiartcommunity', '#midjourney', '#generativeart',
  '#midjourneyart', '#aiartist', '#aiartwork', '#aiartists', '#digitalartist',
  '#midjourneyai', '#stablediffusion', '#dalle', '#aigenerated', '#nft',
  '#midjourneyartwork', '#aigeneratedart', '#apple', '#iphone', '#samsung',
  '#android', '#oneplus', '#python', '#gaming', '#robotics', '#robot', '#iot',
]);

// What a tag is *about*, for when the tag's own text never appears in the copy.
// A piece on OpenAI contains no literal "ai" token and an H-1B headline
// normalizes to "h 1b", so without these the matcher scores almost everything
// zero and silently falls back to a blind shuffle.
const TAG_TERMS = {
  '#ai': ['ai', 'artificial', 'intelligence', 'openai', 'chatgpt', 'gpt', 'llm', 'llms', 'anthropic', 'claude', 'gemini', 'copilot', 'chatbot'],
  '#artificialintelligence': ['ai', 'artificial', 'intelligence', 'openai', 'chatgpt', 'llm', 'anthropic', 'chatbot'],
  '#machinelearning': ['machine learning', 'training data', 'fine tuned', 'neural'],
  '#deeplearning': ['deep learning', 'neural network', 'transformer'],
  '#neuralnetworks': ['neural network', 'neural networks'],
  '#chatgpt': ['chatgpt', 'openai', 'gpt'],
  '#cybersecurity': ['cybersecurity', 'hack', 'hacked', 'hacker', 'hackers', 'breach', 'ransomware', 'malware', 'phishing', 'vulnerability', 'exploit'],
  '#security': ['security', 'breach', 'hack', 'vulnerability', 'ransomware', 'malware', 'privacy'],
  '#startup': ['startup', 'startups', 'founder', 'funding', 'seed', 'venture', 'vc', 'ipo'],
  '#business': ['business', 'revenue', 'profit', 'earnings', 'acquisition', 'merger', 'valuation'],
  '#entrepreneur': ['entrepreneur', 'founder', 'startup'],
  '#apple': ['apple', 'iphone', 'ipad', 'mac', 'macbook', 'ios', 'siri'],
  '#iphone': ['iphone', 'apple', 'ios'],
  '#samsung': ['samsung', 'galaxy'],
  '#android': ['android', 'pixel', 'galaxy'],
  '#oneplus': ['oneplus'],
  '#smartphone': ['smartphone', 'phone', 'phones', 'iphone', 'android', 'galaxy', 'pixel'],
  '#mobile': ['mobile', 'phone', 'smartphone', 'app', 'apps', 'android', 'ios'],
  '#gadgets': ['gadget', 'gadgets', 'device', 'devices', 'wearable', 'headset', 'laptop'],
  '#gadget': ['gadget', 'gadgets', 'device', 'devices', 'wearable', 'headset'],
  '#electronics': ['electronics', 'chip', 'chips', 'semiconductor', 'hardware'],
  '#engineering': ['engineering', 'engineer', 'engineers'],
  '#engineer': ['engineering', 'engineer', 'engineers'],
  '#programming': ['code', 'coding', 'programming', 'developer', 'developers', 'software'],
  '#coding': ['code', 'coding', 'programming', 'developer', 'github'],
  '#programmer': ['programmer', 'developer', 'developers', 'coding'],
  '#developer': ['developer', 'developers', 'github', 'sdk', 'api'],
  '#software': ['software', 'app', 'apps', 'platform', 'open source'],
  '#python': ['python'],
  '#data': ['data', 'dataset', 'datasets', 'database'],
  '#bigdata': ['big data'],
  '#dataanalytics': ['data analytics', 'analytics'],
  '#analytics': ['analytics', 'metrics'],
  '#datascience': ['data science', 'data scientist'],
  '#datascientist': ['data scientist', 'data science'],
  '#science': ['science', 'scientists', 'researchers', 'peer reviewed'],
  '#robotics': ['robot', 'robots', 'robotics', 'humanoid'],
  '#robot': ['robot', 'robots', 'robotics', 'humanoid'],
  '#automation': ['automation', 'automate', 'automated', 'agents', 'robot'],
  '#iot': ['iot', 'sensors', 'smart home', 'connected devices'],
  '#gaming': ['game', 'games', 'gaming', 'xbox', 'playstation', 'nintendo', 'steam'],
  '#india': ['india', 'indian', 'indians', 'delhi', 'mumbai', 'bengaluru', 'bangalore', 'infosys', 'tcs', 'wipro'],
  '#innovation': ['innovation', 'breakthrough', 'first ever', 'unveiled'],
  '#digitaltransformation': ['digital transformation', 'enterprise', 'cloud', 'migration'],
  '#digitalmarketing': ['marketing', 'advertising', 'ad campaign'],
  '#marketing': ['marketing', 'advertising', 'ad campaign', 'brand'],
  '#internet': ['internet', 'web', 'online', 'broadband', 'browser'],
  '#computer': ['computer', 'computing', 'pc', 'laptop', 'processor'],
  '#computerscience': ['computer science', 'algorithm', 'algorithms'],
  '#education': ['education', 'school', 'university', 'student', 'students'],
  '#design': ['design', 'ui', 'ux', 'interface'],
  '#nft': ['nft', 'crypto', 'blockchain', 'bitcoin', 'token'],
  '#aiart': ['ai art', 'image generator', 'midjourney', 'dall', 'stable diffusion', 'text to image', 'generated images'],
  '#digitalart': ['ai art', 'image generator', 'midjourney', 'generated images'],
  '#aiartcommunity': ['ai art', 'midjourney', 'image generator'],
  '#midjourney': ['midjourney'],
  '#midjourneyart': ['midjourney'],
  '#midjourneyai': ['midjourney'],
  '#midjourneyartwork': ['midjourney'],
  '#stablediffusion': ['stable diffusion'],
  '#dalle': ['dall'],
  '#generativeart': ['generative', 'ai art', 'image generator'],
  '#aigenerated': ['ai generated', 'generated', 'synthetic'],
  '#aigeneratedart': ['ai generated', 'ai art'],
  '#aiartist': ['ai art', 'artist'],
  '#aiartwork': ['ai art', 'artwork'],
  '#aiartists': ['ai art', 'artists'],
  '#digitalartist': ['ai art', 'artist'],

  // visa / immigration
  '#h1b': ['h1b', 'h 1b', 'h1 b'],
  '#h1bvisa': ['h1b', 'h 1b', 'h1 b'],
  '#h4visa': ['h4', 'h 4', 'spouse', 'dependent'],
  '#f1visa': ['f1', 'f 1', 'student visa'],
  '#opt': ['opt', 'practical training'],
  '#stemopt': ['stem', 'opt', 'practical training'],
  '#greencard': ['green card', 'greencard', 'permanent residency', 'eb 1', 'eb 2', 'eb 3', 'i 485'],
  '#greencardholder': ['green card', 'permanent resident', 'permanent residency'],
  '#permanentresidency': ['permanent', 'residency', 'green card'],
  '#uscis': ['uscis', 'immigration services'],
  '#visa': ['visa', 'visas'],
  '#visanews': ['visa', 'visas'],
  '#visaupdate': ['visa', 'visas'],
  '#visaapplication': ['application', 'applications', 'apply', 'petition', 'lottery'],
  '#visainterview': ['interview', 'interviews', 'consulate', 'appointment'],
  '#workvisa': ['work', 'employment', 'worker', 'workers', 'visa'],
  '#employmentbasedvisa': ['employment', 'employer', 'sponsorship', 'worker'],
  '#studyvisa': ['study', 'student', 'university'],
  '#travelvisa': ['travel', 'tourist'],
  '#consulate': ['consulate', 'embassy', 'appointment'],
  '#immigration': ['immigration', 'immigrant', 'immigrants', 'deportation', 'border'],
  '#immigrationnews': ['immigration', 'immigrant', 'immigrants'],
  '#immigrationupdate': ['immigration'],
  '#usimmigration': ['immigration', 'us', 'usa', 'american'],
  '#immigrants': ['immigrant', 'immigrants', 'migrants'],
  '#studentvisa': ['student', 'students', 'visa'],
  '#internationalstudents': ['international', 'student', 'students'],
  '#internationalstudent': ['international', 'student', 'students'],
  '#internationaleducation': ['international', 'education', 'university'],
  '#studyabroad': ['study abroad', 'abroad', 'overseas'],
  '#studyabroadlife': ['study abroad', 'abroad'],
  '#studyoverseas': ['overseas', 'abroad'],
  '#overseaseducation': ['overseas', 'education', 'abroad'],
  '#educationabroad': ['education', 'abroad'],
  '#abroadstudies': ['abroad', 'study'],
  '#highereducation': ['university', 'college', 'higher education', 'graduate'],
  '#university': ['university', 'universities', 'campus'],
  '#college': ['college', 'colleges', 'campus'],
  '#student': ['student', 'students'],
  '#students': ['student', 'students'],
  '#studentlife': ['student', 'students', 'campus'],
  '#study': ['study', 'studies', 'student'],
  '#ielts': ['ielts', 'english test'],
  '#studyinusa': ['us', 'usa', 'america', 'american'],
  '#studyincanada': ['canada', 'canadian'],
  '#studyinuk': ['uk', 'britain', 'british'],
  '#studyinaustralia': ['australia', 'australian'],
  '#canadaimmigration': ['canada', 'canadian'],
  '#ukvisa': ['uk', 'britain', 'british'],
  '#australiavisa': ['australia', 'australian'],
  '#canada': ['canada', 'canadian'],
  '#uk': ['uk', 'britain', 'british'],
  '#australia': ['australia', 'australian'],
  '#overseas': ['overseas', 'abroad'],
  '#indianstudents': ['india', 'indian', 'indians'],
  '#indiansabroad': ['india', 'indian', 'indians'],
  '#indiansinusa': ['india', 'indian', 'indians'],
  '#nri': ['india', 'indian', 'indians', 'nri'],
  '#desiabroad': ['india', 'indian', 'indians'],
  '#travel': ['travel', 'flight', 'flights', 'airport'],

  // politics
  '#trump': ['trump'],
  '#donaldtrump': ['trump', 'donald'],
  '#potus': ['trump', 'president', 'presidential'],
  '#tariffs': ['tariff', 'tariffs', 'trade', 'import', 'imports'],
  '#trade': ['trade', 'tariff', 'tariffs', 'exports', 'imports'],
  '#economy': ['economy', 'economic', 'inflation', 'jobs', 'gdp', 'markets', 'recession'],
  '#supremecourt': ['supreme court', 'justices'],
  '#congress': ['congress', 'lawmakers', 'house of representatives'],
  '#senate': ['senate', 'senator', 'senators'],
  '#whitehouse': ['white house'],
  '#election': ['election', 'elections', 'vote', 'voters', 'ballot', 'campaign', 'primary'],
  '#executiveorder': ['executive order'],
  '#foreignpolicy': ['foreign', 'iran', 'china', 'russia', 'ukraine', 'israel', 'nato', 'sanctions', 'diplomacy'],
  '#geopolitics': ['iran', 'china', 'russia', 'ukraine', 'israel', 'nato', 'sanctions', 'global'],
  '#republicans': ['republican', 'republicans', 'gop'],
  '#democrats': ['democrat', 'democrats', 'democratic'],
  '#washington': ['washington', 'dc', 'capitol'],
  '#government': ['government', 'federal', 'shutdown'],
  '#policy': ['policy', 'policies', 'regulation', 'regulators'],
  '#democracy': ['democracy', 'democratic norms', 'civil rights'],
  '#lawandpolitics': ['lawsuit', 'judge', 'court ruling', 'legal challenge', 'indictment'],
  '#uspolitics': ['us', 'usa', 'american', 'america', 'washington'],
  '#usnews': ['us', 'usa', 'american', 'america'],
  '#america': ['america', 'american', 'us', 'usa'],
  '#usa': ['usa', 'us', 'american', 'america'],
  '#nationalnews': ['national', 'federal', 'nationwide'],
  '#politicalnews': ['political', 'politics', 'politician'],
  '#politics': ['politics', 'political', 'politician', 'lawmakers'],
  '#worldnews': ['global', 'worldwide'],
};

// A tag with no entry above matches only its own word (#technology <- "technology").
function tagTerms(tag) {
  return TAG_TERMS[tag] || [tag.slice(1)];
}

// Word-boundary matching, not substring: "#ai" must not fire on "said" or "email".
function relevanceIndex(text) {
  const flat = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { flat, words: new Set(flat ? flat.split(' ') : []) };
}

// Plural-tolerant: "breach" has to match a headline that says "breaches", or
// half the term lists would need every inflection spelled out. Both the -s and
// -es forms matter — "breachs" is not a word.
const ES_PLURAL = /(?:s|x|z|ch|sh)$/;

function singular(word) {
  if (word.endsWith('es') && ES_PLURAL.test(word.slice(0, -2))) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function hasWord(index, word) {
  if (index.words.has(word)) return true;
  if (index.words.has(word + 's')) return true;
  if (ES_PLURAL.test(word) && index.words.has(word + 'es')) return true;
  return index.words.has(singular(word));
}


// Scoring is a specificity ladder. A multi-word phrase ("green card", "h 1b")
// is the strongest signal — nothing says it by accident — then the tag's own
// word, then a plain alias. Terms are counted once per stem so a list holding
// both 'visa' and 'visas' cannot out-score a genuinely specific tag.
function tagScore(tag, index) {
  const counted = new Set();
  let score = 0;

  if (hasWord(index, tag.slice(1))) {
    score += 2;
    counted.add(singular(tag.slice(1)));
  }

  for (const term of tagTerms(tag)) {
    if (term.includes(' ')) {
      if (index.flat.includes(term)) score += 3;
      continue;
    }
    const key = singular(term);
    if (counted.has(key)) continue;
    if (hasWord(index, term)) {
      score += 1;
      counted.add(key);
    }
  }
  return score;
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pick `count` hashtags for a post. Given the post's own copy, tags the story
// actually talks about come first — ties shuffled, so two posts on the same
// topic don't get identical captions — and any leftover slots are filled at
// random. With no copy it degrades to the old blind shuffle, minus the
// match-only tags, which is what the pool-variety tests exercise.
// An account's own tags are almost always brand or beat tags, so they are
// offered ahead of the pool — but capped, because filling every slot with the
// same fixed tags would undo the per-post relevance matching below and make
// every caption identical.
const MAX_ACCOUNT_TAGS = 2;

function normalizeAccountTags(extra) {
  if (!Array.isArray(extra)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of extra) {
    const tag = String(raw || '').trim();
    if (!/^#?[A-Za-z0-9]+$/.test(tag)) continue;
    const withHash = tag.startsWith('#') ? tag : `#${tag}`;
    const key = withHash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withHash);
  }
  return out;
}

function pickHashtags(count = 5, category, text, extra = []) {
  const pool = HASHTAG_POOLS[category] || HASHTAG_POOL;
  const index = relevanceIndex(text);
  const anchors = ANCHOR_TAGS[category] || ANCHOR_TAGS.tech;
  // Filler runs anchors first, then the rest of the pool: when a story matches
  // nothing, the empty slots should read as neutral (#technews) rather than as
  // a wrong claim about the post (#bigdata on an obituary).
  const filler = [
    ...shuffle(pool.filter((tag) => anchors.includes(tag))),
    ...shuffle(pool.filter((tag) => !anchors.includes(tag) && !MATCH_ONLY.has(tag))),
  ];

  // Account tags lead, relevant ones first, so a tag that the story actually
  // talks about is never displaced by one that merely belongs to the account.
  const accountTags = normalizeAccountTags(extra);
  const leading = [
    ...accountTags.filter((tag) => tagScore(tag, index) > 0),
    ...accountTags.filter((tag) => tagScore(tag, index) === 0),
  ].slice(0, Math.min(MAX_ACCOUNT_TAGS, count));

  if (!index.flat) {
    const rest = shuffle(filler).filter((tag) => !leading.includes(tag));
    return [...leading, ...rest].slice(0, count);
  }

  const matched = shuffle(pool)
    .map((tag) => ({ tag, score: tagScore(tag, index) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.tag);

  const chosen = [...leading, ...matched.filter((t) => !leading.includes(t))].slice(0, count);
  const taken = new Set(chosen);
  for (const tag of filler) {
    if (chosen.length >= count) break;
    if (!taken.has(tag)) {
      chosen.push(tag);
      taken.add(tag);
    }
  }
  return chosen;
}

// Build the final caption: hook text (with any model-inlined hashtags stripped)
// plus a single line of 5 hashtags matched against what the post actually says.
function buildCaption(parsed, category, text, extra = []) {
  const hookText = cleanText(parsed?.caption)
    .replace(/#\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const line = pickHashtags(5, category, text, extra).join(' ');
  return line ? `${hookText}\n\n${line}` : hookText;
}

function normalizeBadge(value) {
  const badge = cleanText(value).toUpperCase();
  if (ALLOWED_BADGES.has(badge)) return badge;
  if (badge.includes('AI')) return 'AI UPDATE';
  if (badge.includes('BREAK')) return 'BREAKING';
  if (badge.includes('ALERT')) return 'ALERT';
  return DEFAULT_BADGE;
}

function normalizeSlides(parsed, article) {
  const allSlides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const hook = allSlides.find((slide) => slide?.type === 'hook') || allSlides[0] || {};

  // Context slides, in order — any non-hook slide that actually has body text.
  const details = allSlides.filter((slide) => slide && slide !== hook && cleanText(slide.body));

  const slides = [
    {
      type: 'hook',
      badge: normalizeBadge(hook.badge),
      teaser: cleanText(hook.teaser || 'What happened?'),
      headline: cleanText(article?.title || hook.headline || ''),
    },
    {
      type: 'detail',
      body: cleanText(details[0]?.body || ''),
    },
  ];

  // Optional 3rd slide: keep the model's second context slide ONLY when it has
  // real, distinct content — never a thin filler or a near-duplicate of slide 2.
  const extra = cleanText(details[1]?.body || '');
  if (extra && countWords(extra) >= 12 && extra.toLowerCase() !== slides[1].body.toLowerCase()) {
    slides.push({ type: 'detail', body: extra });
  }

  return slides;
}

function evaluateCarouselContent(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const hook = slides[0] || {};
  const detail = slides[1] || {};
  const bodyWordCount = countWords(detail.body);
  const highlightCount = countHighlights(detail.body);
  const hashtags = extractHashtags(content?.caption);
  const warnings = [];
  const checks = {
    hasTwoSlides: slides.length >= 2 && slides.length <= 3,
    hasHeadline: Boolean(cleanText(hook.headline)),
    hasDetailBody: Boolean(cleanText(detail.body)),
    bodyWordCount,
    bodyLengthOk: bodyWordCount >= 70 && bodyWordCount <= 95,
    highlightCount,
    hasSingleHighlight: highlightCount === 1,
    hashtagCount: hashtags.length,
    hasFiveHashtags: hashtags.length === 5,
    endsWithQuestion: /\?\s*$/.test(cleanText(detail.body)),
  };

  if (!checks.hasTwoSlides) warnings.push('Expected 2 or 3 slides.');
  if (!checks.hasHeadline) warnings.push('Hook slide is missing the article headline.');
  if (!checks.hasDetailBody) warnings.push('Detail slide is missing body copy.');
  if (!checks.bodyLengthOk) warnings.push('Detail body should be 70-95 words — more than that renders too small to read on a phone, so the extra belongs on slide 3.');
  if (!checks.hasSingleHighlight) warnings.push('Detail body should include exactly one highlighted phrase.');
  if (!checks.hasFiveHashtags) warnings.push('Caption should include exactly 5 hashtags.');
  if (checks.endsWithQuestion) warnings.push('Detail body should end with a concluding statement, not a question.');

  const score =
    (checks.hasTwoSlides ? 20 : 0) +
    (checks.hasHeadline ? 15 : 0) +
    (checks.hasDetailBody ? 15 : 0) +
    (checks.bodyLengthOk ? 20 : 0) +
    (checks.hasSingleHighlight ? 20 : 0) +
    (checks.hasFiveHashtags ? 10 : 0) -
    (checks.endsWithQuestion ? 10 : 0);

  return {
    score: Math.max(0, Math.min(100, score)),
    checks,
    warnings,
  };
}

function normalizeAndEvaluateCarousel(parsed, article, account) {
  const slides = normalizeSlides(parsed, article);

  // Hashtags are matched against what the post itself says, so the slide copy
  // has to be normalized before the caption is built. Headline + slide bodies
  // only: matching the full scraped article would pull in tags for whatever the
  // source mentioned in passing rather than what the carousel is about.
  const postCopy = [
    article?.title,
    cleanText(parsed?.caption),
    ...slides.map((slide) => [slide.teaser, slide.headline, slide.body].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ');

  const normalized = {
    slides,
    imagePrompt: cleanText(parsed?.imagePrompt),
    // The account's own tags reach the published caption here. The prompt asks
    // the model for them too, but this function rebuilds the hashtag line from
    // scratch, so anything not passed in at this point is discarded.
    caption: buildCaption(parsed, article?.category, postCopy, account?.hashtagExtra),
  };

  return {
    ...normalized,
    quality: evaluateCarouselContent(normalized),
  };
}

module.exports = {
  pickHashtags,
  cleanText,
  countWords,
  countHighlights,
  extractHashtags,
  normalizeAndEvaluateCarousel,
  evaluateCarouselContent,
};

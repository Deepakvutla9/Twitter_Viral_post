// Story-level dedupe: is this candidate the same news as something already posted?
//
// URL dedupe cannot answer that. One event — the proposed $70,000 OPT fee — was
// published by PIE News, the Federal Register and Indian Express under three
// URLs, so each looked new and the account ran it three times in six days.
//
// The history stores URLs only, but a news URL carries its headline as a slug, so
// the posted side is compared from that and no schema change is needed. A
// candidate is compared on its title.
//
// Two rules, because "the same story" has two meanings to a follower:
//
//   event — same headline in different words. Blocked for EVENT_DAYS.
//   saga  — a different article on the same program and the same angle (OPT +
//           fee, H-1B + lottery). To the audience it is the same news, so it is
//           held back for SAGA_DAYS even when the wording shares little.
//
// A program on its own (any OPT story) is not blocked — that would starve the
// beat — but is ranked down while it was in the last few posts, so the feed
// rotates instead of running OPT four days in a row.

const EVENT_DAYS = Number(process.env.STORY_EVENT_DAYS) || 30;
const SAGA_DAYS = Number(process.env.STORY_SAGA_DAYS) || 5;
const RECENT_POSTS_FOR_PENALTY = 3;
const PROGRAM_PENALTY = 40;
const DAY_MS = 86400000;

const STOPWORDS = new Set((
  'a an the and or but for nor so yet of in on at to by with from as is are was were be been ' +
  'it its this that these those will would could should may might can has have had not no new ' +
  'says say said after before over under into out up down about amid against more most now ' +
  'what why how who when here there their they them his her our your you we us amp ' +
  'news latest update updates live report reports according'
).split(' '));

// Phrases that name the same thing in different outlets' house styles.
const PHRASES = [
  [/optional practical training/g, ' opt '],
  [/stem[ -]opt/g, ' opt '],
  [/curricular practical training/g, ' cpt '],
  [/\bh[ -]?1[ -]?b\b/g, ' h1b '],
  [/\bf[ -]?1\b/g, ' f1 '],
  [/\bj[ -]?1\b/g, ' j1 '],
  [/\beb[ -]?5\b/g, ' eb5 '],
  [/\beb[ -]?2\b/g, ' eb2 '],
  [/\beb[ -]?3\b/g, ' eb3 '],
  [/green[ -]?cards?/g, ' greencard '],
  [/permanent residen(?:t|cy|ce)/g, ' greencard '],
  [/visa bulletin/g, ' visabulletin '],
  [/work permits?|employment authori[sz]ation/g, ' ead '],
  [/\bu\.?s\.?\b|united states|america(?:n)?/g, ' us '],
  [/\b(?:universit(?:y|ies)|unis?|colleges?)\b/g, ' univers '],
];

// "$70,000", "70,000", "70000", "$70k", "70 thousand" all become 70000.
function normaliseNumbers(text) {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000)))
    .replace(/(\d+(?:\.\d+)?)\s*(?:lakh)\b/g, (_, n) => String(Math.round(parseFloat(n) * 100000)))
    .replace(/(\d+(?:\.\d+)?)\s*(?:million|mn)\b/g, (_, n) => String(Math.round(parseFloat(n) * 1000000)))
    .replace(/(\d{1,3}(?:,\d{3})+)/g, (m) => m.replace(/,/g, ''));
}

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  // Only sibilant endings take -es (boxes, searches); probes, rules, fees take -s.
  if (w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

// A URL slug becomes the headline it was built from: path segments, trailing
// numeric ids and file extensions dropped, separators back to spaces. Only the
// last meaningful segment is the headline; the rest is section names.
function slugToText(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return ''; }
  const parts = path.split('/').filter(Boolean)
    .map((p) => p.replace(/\.(cms|html?|php|aspx?)$/i, ''))
    .filter((p) => !/^\d+$/.test(p) && !/^articleshow$/i.test(p));
  const slug = parts.sort((a, b) => b.split('-').length - a.split('-').length)[0] || '';
  return slug
    .replace(/-?\d{8,}$/g, '')      // trailing article ids (…-10911876, …-101791680529306)
    .replace(/[-_]+/g, ' ');
}

function tokenise(text) {
  let t = normaliseNumbers(String(text || '').toLowerCase().replace(/\$/g, ' '));
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  return new Set(
    t.split(/[^a-z0-9]+/)
      .filter((w) => w && w.length > 1 && !STOPWORDS.has(w))
      .map(stem),
  );
}

// Programs: the thing a story is about.
const PROGRAMS = ['opt', 'cpt', 'h1b', 'f1', 'j1', 'eb5', 'eb2', 'eb3', 'greencard', 'visabulletin', 'ead'];
// Angles: what is happening to it. Two stories on one program with one angle
// are one saga.
const ANGLES = {
  fee: ['fee', 'cost', 'charge', 'price', 'surcharge', 'levy'],
  ban: ['ban', 'suspend', 'suspension', 'halt', 'freeze', 'curb', 'restrict', 'restriction', 'crackdown', 'pause'],
  rule: ['rule', 'proposal', 'propose', 'regulation', 'overhaul', 'change', 'reform'],
  lottery: ['lottery', 'selection', 'cap', 'registration'],
  fraud: ['fraud', 'probe', 'investigation', 'audit', 'raid'],
  interview: ['interview', 'slot', 'appointment', 'stamping', 'wait', 'delay', 'backlog'],
  court: ['court', 'lawsuit', 'judge', 'ruling', 'sue'],
};
const BIG_NUMBER = /^\d{4,}$/;

function describe(text) {
  const tokens = tokenise(text);
  const programs = PROGRAMS.filter((p) => tokens.has(p));
  const angles = Object.entries(ANGLES)
    .filter(([, words]) => words.some((w) => tokens.has(stem(w))))
    .map(([name]) => name);
  const numbers = [...tokens].filter((w) => BIG_NUMBER.test(w) && !/^20\d\d$/.test(w));
  return { tokens, programs, angles, numbers };
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const share = (a, b) => a.some((x) => b.includes(x));

/**
 * How `candidate` relates to a posted story: 'event', 'saga' or null.
 * Both arguments come from describe().
 */
function relation(candidate, posted) {
  if (jaccard(candidate.tokens, posted.tokens) >= 0.4) return 'event';
  // The same distinctive figure on the same program is the same announcement,
  // whatever each outlet called it.
  if (share(candidate.numbers, posted.numbers) && share(candidate.programs, posted.programs)) return 'event';
  // Same program and a good share of the wording: one story told twice, even when
  // each outlet pads it with different context.
  // Needs four shared words so a terse title ("Optional Practical Training Fees")
  // is judged as a story line, not claimed as the same event on two words.
  if (share(candidate.programs, posted.programs)) {
    let shared = 0;
    for (const w of candidate.tokens) if (posted.tokens.has(w)) shared += 1;
    if (shared >= 4 && jaccard(candidate.tokens, posted.tokens) >= 0.25) return 'event';
  }
  if (share(candidate.programs, posted.programs) && share(candidate.angles, posted.angles)) return 'saga';
  return null;
}

/**
 * Builds a checker from the account's recent history.
 * `recent` is [{ url, postedAt }], newest first, already limited to the window.
 * Returns { blocked(item) -> reason|null, penalty(item) -> number }.
 */
function buildGuard(recent, now = Date.now()) {
  const posted = recent
    .map((r, i) => ({
      ...describe(slugToText(r.url)),
      ageMs: now - new Date(r.postedAt).getTime(),
      recency: i,
    }))
    // A slug too thin to read (an id-only URL) must not match everything.
    .filter((p) => p.tokens.size >= 3);

  return {
    size: posted.length,
    blocked(item) {
      const c = describe(`${item.title || ''}`);
      if (c.tokens.size < 2) return null;
      for (const p of posted) {
        const rel = relation(c, p);
        if (rel === 'event' && p.ageMs <= EVENT_DAYS * DAY_MS) return `same event as a post ${Math.round(p.ageMs / DAY_MS)}d ago`;
        if (rel === 'saga' && p.ageMs <= SAGA_DAYS * DAY_MS) return `same ${p.programs.join('/')} story line as a post ${Math.round(p.ageMs / DAY_MS)}d ago`;
      }
      return null;
    },
    // Rank down a program that was in the last few posts, so a beat dominated by
    // one program rotates. Not a block: a quiet news day still gets a post.
    penalty(item) {
      const c = describe(`${item.title || ''}`);
      if (!c.programs.length) return 0;
      const lately = posted.filter((p) => p.recency < RECENT_POSTS_FOR_PENALTY);
      return lately.some((p) => share(c.programs, p.programs)) ? PROGRAM_PENALTY : 0;
    },
  };
}

module.exports = { buildGuard, describe, relation, slugToText, tokenise, EVENT_DAYS, SAGA_DAYS };

// ── VIRALITY SIGNALS ─────────────────────────────────────────────────────────
//
// When ET, TOI, Hindustan Times and PIE News all run the same development within
// a day, that is the story the audience is looking for. Counting it needs no new
// source: the feeds are already fetched, and relation() already knows when two
// headlines are one event.
//
// Reddit was tried as an engagement signal and dropped: unauthenticated it
// rate-limits (429) after a request or two from a laptop, would be worse from a
// shared host, and its RSS carries no upvote counts anyway.

const COVERAGE_BONUS = Number(process.env.COVERAGE_BONUS) || 15;
const COVERAGE_CAP = 4;      // outlets beyond the fourth add nothing
const TREND_BONUS = Number(process.env.TREND_BONUS) || 20;

/**
 * Per-item count of distinct outlets that ran the same event.
 * `items` need { title, source }. Returns a Map(item -> outlets, itself included).
 */
function coverageCounts(items) {
  const described = items.map((item) => ({ item, d: describe(item.title || ''), source: item.source || item.url }));
  const counts = new Map();
  for (const a of described) {
    const outlets = new Set([a.source]);
    if (a.d.tokens.size >= 2) {
      for (const b of described) {
        if (b === a || outlets.has(b.source) || b.d.tokens.size < 2) continue;
        // 'event' only. A saga match is the same subject, not the same news, and
        // would count three different OPT articles as three outlets on one story.
        if (relation(a.d, b.d) === 'event') outlets.add(b.source);
      }
    }
    counts.set(a.item, outlets.size);
  }
  return counts;
}

const coverageBonus = (outlets) => Math.min(Math.max(outlets - 1, 0), COVERAGE_CAP - 1) * COVERAGE_BONUS;

/** Does a trending search term appear whole in this headline? */
function matchesTrend(item, trendTerms) {
  const t = tokenise(item.title || '');
  return trendTerms.some((term) => {
    const words = [...tokenise(term)];
    return words.length >= 2 && words.every((w) => t.has(w));
  });
}

module.exports.coverageCounts = coverageCounts;
module.exports.coverageBonus = coverageBonus;
module.exports.matchesTrend = matchesTrend;
module.exports.TREND_BONUS = TREND_BONUS;

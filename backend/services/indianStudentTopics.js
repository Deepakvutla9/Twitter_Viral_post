// ── WHAT THIS POOL IS FOR ────────────────────────────────────────────────────
//
// One audience: Indian students and workers in the United States. Everything
// they need to act on falls into four buckets, and a story earns a slot by
// belonging to one of them — not by containing the word "visa".
//
//   status  — the F-1 route and keeping it: interviews, stamping, I-20, SEVIS
//   work    — permission to work: OPT, STEM OPT, CPT, the EAD and its forms
//   pathway — what comes after study: H-1B, the employment green card queue
//   life    — the decisions around all of it: admissions, tests, loans, costs
//
// ── HOW A STORY IS ADMITTED ──────────────────────────────────────────────────
//
// Not by matching a keyword list. A list only ever contains the phrasings
// someone thought of, and immigration coverage invents new ones constantly —
// a rule with a new form number, an agency memo, a category nobody has written
// about before. Matching literally would quietly drop exactly the news that
// matters most, which is the new kind.
//
// So admission runs on independent signals, each recognising a *shape* rather
// than a phrase:
//
//   codes     — status and form identifiers by pattern: I-539, DS-260, EB-5,
//               H-1B1, 221(g). Any form number reads, including unseen ones.
//   agencies  — who acts: USCIS, DHS, ICE, SEVP, the consulates, the Register.
//   concepts  — the vocabulary of immigration itself, not of one program.
//   audience  — who it lands on: Indians, international students, foreign
//               workers, the people on these routes.
//   buckets   — the domain keywords below, as evidence and for ranking.
//
// A story is in when it carries an unambiguous signal (a form code, an agency
// acting on immigration), or when weaker signals corroborate each other. The
// keyword buckets then decide rank, not membership.

// ── SIGNALS ──────────────────────────────────────────────────────────────────

// Status and form identifiers, by shape. This is what generalises: I-765 and
// I-131 and next year's I-whatever all read the same, as do every EB and H
// category, without anyone maintaining a list of them.
const CODE_SIGNAL = new RegExp([
  '\\b(?:form\\s+)?i-\\d{2,3}\\b',        // I-20, I-765, I-983, I-140, I-485, I-539
  '\\bds-\\d{3}\\b',                       // DS-160, DS-260
  '\\beb-?[1-5]\\b',                       // employment-based preference categories
  '\\b[hlfjmoprq]-?[1-4][ab]?\\b',         // H-1B, H-4, L-1, F-1, J-1, M-1, O-1, P-3
  '\\b2\\d{2}\\([a-z]\\)\\b',              // 214(b), 221(g)
  '\\b(?:opt|cpt|ead|sevis|sevp|lca|perm|rfe|noid|aos|nvc|i-?94)\\b',
].join('|'), 'i');

// Who acts. An immigration agency doing something is news for this audience
// whatever vocabulary the outlet chose for it.
const AGENCY_SIGNAL = /\b(uscis|u\.s\.c\.i\.s|dhs|homeland security|ice|immigration and customs|cbp|customs and border|sevp|state department|department of state|consulate|consular|embassy|federal register|department of labor|dol|citizenship and immigration services|border protection)\b/i;

// The vocabulary of immigration policy itself. Strong enough that the cohort
// alone corroborates it — these words are not used about anything else.
const CONCEPT_SIGNAL = /\b(visas?|immigration|nonimmigrant|non-immigrant|green cards?|permanent residen(t|cy)|work permits?|work authorisation|work authorization|deportation|deported|removal proceedings|petitions?|sponsorship|sponsored|stamping|interview slots?|priority dates?|visa bulletin|quota|overstay|out of status|naturalisation|naturalization|asylum|port of entry|travel ban|entry ban|entry restrictions?|proclamation|parole|vetting|consular processing|terms of admission)\b/i;

// The same subject in words that have an ordinary life too. Real signals, but
// they need something else in the headline before they mean immigration.
const WEAK_CONCEPT_SIGNAL = /\b(immigrants?|migrants?|status|applicants?|appointments?|interviews?|backlogs?|enrol?ment|screening)\b/i;

// Who it lands on. "Indian" is the sharpest form, but the cohort is also named
// as international students, foreign workers, skilled migrants — and Indian
// coverage routinely locates a story by the consulate city instead.
const AUDIENCE_SIGNAL = /\b(india|indian|indians|indian-origin|nri|nris|desi|bharat|hyderabad|bengaluru|bangalore|mumbai|new delhi|chennai|kolkata|pune|ahmedabad|international students?|foreign students?|overseas students?|foreign graduates?|international graduates?|foreign workers?|skilled workers?|skilled migrants?|foreign nationals?|visa holders?|h-?1b holders?|students? abroad|studying abroad)\b/i;

// Anything about the United States, used to place a story rather than admit it.
const US_TERMS = /\b(us|u\.s\.|usa|america|american|united states|washington|uscis|dhs|state department)\b/i;
const INDIA_TERMS = /\b(india|indian|indians|indian-origin|nri|nris|desi|bharat|hyderabad|bengaluru|bangalore|mumbai|new delhi|chennai|kolkata|pune|ahmedabad)\b/i;

// Travel listicles and entertainment clear any keyword gate on the word "visa"
// and tell a student nothing. Excluded outright rather than ranked low, because
// they are numerous enough to crowd out real policy news.
const NOISE_TERMS = /\b(visa[- ]free|visa on arrival|best countries to visit|travel guide|honeymoon|tourist hotspots?|bollywood|box office|horoscope|astrology|recipe|cricket (match|score|team|world cup))\b/i;

// ── DOMAIN KEYWORDS (evidence, and the ranking) ──────────────────────────────

const STATUS_TERMS = [
  ['f-1 visa', 26], ['f1 visa', 26], ['student visa', 26], ['f-1 status', 24],
  ['f-1 student', 24], ['visa stamping', 22], ['visa interview', 22],
  ['visa slot', 22], ['visa appointment', 22], ['interview waiver', 20],
  ['dropbox', 18], ['administrative processing', 20], ['214(b)', 22],
  ['ds-160', 20], ['i-20', 24], ['travel signature', 18], ['sevis', 22],
  ['sevis fee', 22], ['sevp', 20], ['designated school official', 16],
  ['change of status', 20], ['reinstatement', 18], ['duration of status', 20],
  ['grace period', 18], ['full-time enrollment', 14], ['us embassy', 16],
  ['us consulate', 16], ['consulate', 12], ['embassy', 10],
  ['student and exchange visitor', 18], ['international student', 18],
  ['indian student', 22],
];

const WORK_TERMS = [
  ['optional practical training', 26], ['opt', 22], ['post-completion opt', 26],
  ['pre-completion opt', 24], ['stem opt', 28], ['ead', 22],
  ['employment authorization', 24], ['i-765', 22], ['i-983', 20],
  ['unemployment days', 20], ['sevp portal', 20], ['e-verify', 18],
  ['training plan', 14], ['curricular practical training', 26], ['cpt', 22],
  ['day 1 cpt', 24], ['on-campus employment', 18], ['off-campus employment', 18],
  ['economic hardship', 16], ['severe economic hardship', 22],
  ['work authorization', 22], ['work permit', 20],
  ['co-op program', 16],
];

const PATHWAY_TERMS = [
  ['h-1b', 30], ['h1b', 30], ['h-4', 24], ['lottery', 22], ['cap-exempt', 20],
  ['cap-subject', 20], ['specialty occupation', 18], ['sponsorship', 18],
  ['h-1b transfer', 22], ['cap-gap', 22], ['prevailing wage', 20],
  ['labor condition application', 20], ['lca', 12], ['request for evidence', 20],
  ['rfe', 16], ['premium processing', 20], ['consular processing', 18],
  ['green card', 24], ['eb-1', 20], ['eb-2', 22], ['eb-3', 22], ['perm', 16],
  ['labor certification', 20], ['priority date', 24], ['visa bulletin', 26],
  ['adjustment of status', 20], ['i-140', 20], ['i-485', 20], ['backlog', 20],
  ['retrogression', 22], ['uscis', 18], ['permanent residency', 18],
];

// Bucket four are ordinary words in India — see the context rule in assess().
const LIFE_TERMS = [
  ['ms in usa', 22], ['stem degree', 16], ['university admission', 16],
  ['graduate school', 14], ['grad school', 14], ['gre', 16], ['gre waiver', 20],
  ['toefl', 16], ['ielts', 16], ['education loan', 20], ['student loan', 20],
  ['cost of living', 16], ['tuition', 16], ['scholarship', 14],
  ['university application', 16], ['college admission', 14], ['us universities', 16],
  ['internship', 14],
];

const BUCKETS = { status: STATUS_TERMS, work: WORK_TERMS, pathway: PATHWAY_TERMS, life: LIFE_TERMS };

// Most domain terms are decisive: nobody writes "Designated School Official" or
// "cap-gap" about anything else, so one is enough to admit a story. These are
// the exceptions — real terms of art that are also ordinary English. A lottery
// win in Chennai and a green card lottery are the same word, so these wait for
// corroboration instead of admitting on their own.
const AMBIGUOUS_ALONE = new Set([
  'lottery', 'cap-exempt', 'cap-subject', 'perm', 'lca', 'rfe', 'sponsorship',
  'consulate', 'embassy', 'grace period', 'reinstatement', 'training plan',
  'economic hardship', 'dropbox', 'backlog', 'internship', 'scholarship',
  'tuition', 'gre', 'toefl', 'ielts', 'opt',
]);

// Tests and degrees that exist only for going abroad. A story naming one is
// about this audience whether or not it also says "US" or "India".
const ABROAD_STUDY_TERMS = /\b(gre|gmat|toefl|ielts|ms in usa|study abroad|us universities|stem degree)\b/i;

// The rest of bucket four are ordinary words. "Cost of living rises in Texas" is
// not a story for this page; "cost of living for Indian students in the US" is —
// the difference is whether anyone is studying in it.
const EDUCATION_ANCHOR = /\b(students?|universit(y|ies)|college|campus|schools?|education|degree|admissions?|scholarships?|tuition|coursework|internship)\b/i;
const ABROAD_CUE = /\b(abroad|overseas|foreign universit|us|u\.s\.|usa|america|american|uk|canada|australia|germany|ireland)\b/i;

// A term like "opt", "perm" or "gre" is a common word as well as a term of art,
// so short terms match on word boundaries rather than as substrings: "opt" must
// not fire on "option", nor "perm" on "permanent".
function mentions(hay, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term.length <= 6) {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(hay);
  }
  return hay.includes(term);
}

/**
 * Which buckets a story touches, and the weight it earned in each.
 *
 * Exported because the ranking and the evidence need the same answer, and
 * because a keyword list that has quietly stopped matching is worth testing.
 */
function matchBuckets(text) {
  const hay = String(text || '').toLowerCase();
  const out = {};
  for (const [bucket, terms] of Object.entries(BUCKETS)) {
    let weight = 0;
    const hits = [];
    for (const [term, w] of terms) {
      if (mentions(hay, term)) { weight += w; hits.push(term); }
    }
    if (hits.length) out[bucket] = { weight, hits };
  }
  return out;
}

/**
 * Should this story be in the pool, and why?
 *
 * Returns the reasons as well as the verdict: an admission rule nobody can
 * inspect is one nobody can tune, and the logs are where a wrong call gets
 * noticed. `sourceIsDedicated` is the prior for a feed that only carries this
 * beat (an NRI or immigration desk) — it corroborates, never admits alone.
 */
function assess(item, { sourceIsDedicated = false } = {}) {
  const title = String(item?.title || '');
  const hay = `${title} ${item?.summary || ''}`;
  const reasons = [];

  if (NOISE_TERMS.test(hay)) return { admit: false, reasons: ['noise'], buckets: {} };

  const buckets = matchBuckets(hay);
  const hasCode = CODE_SIGNAL.test(hay);
  const hasAgency = AGENCY_SIGNAL.test(hay);
  const hasConcept = CONCEPT_SIGNAL.test(hay);
  const hasWeakConcept = WEAK_CONCEPT_SIGNAL.test(hay);
  const hasAudience = AUDIENCE_SIGNAL.test(hay);
  const hardBuckets = ['status', 'work', 'pathway'].filter((b) => buckets[b]);
  const decisive = hardBuckets
    .flatMap((b) => buckets[b].hits)
    .filter((term) => !AMBIGUOUS_ALONE.has(term));

  if (hasCode) reasons.push('status-code');
  if (hasAgency) reasons.push('agency');
  if (hasConcept) reasons.push('concept');
  else if (hasWeakConcept) reasons.push('weak-concept');
  if (hasAudience) reasons.push('audience');
  for (const b of hardBuckets) reasons.push(`bucket:${b}`);
  if (decisive.length) reasons.push(`decisive:${decisive[0]}`);
  if (sourceIsDedicated) reasons.push('dedicated-source');

  // Unambiguous on their own: a form or status code is not language anyone uses
  // by accident, and neither is most of the domain vocabulary.
  if (hasCode) return { admit: true, reasons, buckets };
  if (decisive.length) return { admit: true, reasons, buckets };

  // An agency acting, corroborated by immigration language or by the cohort.
  // Neither half is enough alone, which is what keeps "ICE hockey" out.
  if (hasAgency && (hasConcept || hasAudience)) return { admit: true, reasons, buckets };

  // Policy language about this cohort. Both halves are specific, so the pair
  // stands without a keyword — this is the path that catches phrasing nobody
  // wrote down: a proclamation on entry, a parole rule for foreign graduates.
  if (hasConcept && hasAudience) return { admit: true, reasons, buckets };

  // A term of art that is also ordinary English, rescued by policy language
  // around it: "green card lottery", not "lottery winner in Chennai".
  if (hardBuckets.length && hasConcept) return { admit: true, reasons, buckets };

  // Everyday words for the same subject, from a desk that covers only this beat.
  if (hasWeakConcept && hasAudience && (sourceIsDedicated || hardBuckets.length > 0)) {
    return { admit: true, reasons, buckets };
  }

  // Bucket four alone: ordinary words that need the journey named before they
  // mean anything here.
  if (buckets.life) {
    if (ABROAD_STUDY_TERMS.test(hay)) { reasons.push('abroad-study'); return { admit: true, reasons, buckets }; }
    if (EDUCATION_ANCHOR.test(hay) && (US_TERMS.test(hay) || (INDIA_TERMS.test(hay) && ABROAD_CUE.test(hay)))) {
      reasons.push('bucket:life+context');
      return { admit: true, reasons, buckets };
    }
  }

  return { admit: false, reasons: reasons.length ? reasons : ['no-signal'], buckets };
}

function isIndianStudentStory(item, opts) {
  return assess(item, opts).admit;
}

// What makes a story worth acting on rather than merely reading. A rule that
// changes, a fee that lands, a date that binds — these are the posts a student
// needs, and they should outrank commentary about the same subject.
const IMPACT_TERMS = [
  ['new rule', 14], ['final rule', 14], ['proposed rule', 12], ['policy change', 12],
  ['executive order', 12], ['federal register', 12], ['court', 10], ['lawsuit', 10],
  ['ruling', 10], ['effective from', 12], ['takes effect', 12], ['deadline', 12],
  ['fee', 10], ['cap', 10], ['suspend', 12], ['ban', 12], ['denial', 10],
  ['rejection', 10], ['wait time', 10], ['processing time', 12], ['revoked', 12],
  ['crackdown', 10], ['announced', 8], ['guidance', 10],
];

// Commentary and personality pieces are real coverage but not actionable, and a
// pool that ranks them first reads like a gossip feed rather than a service.
const SOFT_TERMS = [
  ['says', 6], ['slams', 8], ['reacts', 8], ['viral', 10], ['reddit', 8],
  ['shares', 6], ['opinion', 8], ['debate', 6], ['claims', 6],
];

function sumTerms(hay, terms, cap) {
  let total = 0;
  for (const [term, weight] of terms) if (mentions(hay, term)) total += weight;
  return Math.min(total, cap);
}

/**
 * Rank within the pool: what it is about, whether anything actually changed,
 * whether it names the audience, and how fresh it is.
 *
 * Signals score as well as admit, so a story that arrives in unfamiliar
 * vocabulary — no bucket keyword, but a form code and an agency — still ranks
 * on its merits instead of sitting at the bottom on zero.
 *
 * The title is weighted over the summary because feed summaries trail unrelated
 * furniture: other headlines, section names, promo lines.
 */
function scoreIndianStudentStory(item) {
  const title = String(item?.title || '');
  const hay = `${title} ${item?.summary || ''}`.toLowerCase();

  let score = 0;
  for (const { weight } of Object.values(matchBuckets(hay))) score += weight;

  if (CODE_SIGNAL.test(hay)) score += 18;
  if (AGENCY_SIGNAL.test(hay)) score += 12;
  if (CONCEPT_SIGNAL.test(hay)) score += 8;
  if (AUDIENCE_SIGNAL.test(hay)) score += 10;

  score += sumTerms(hay, IMPACT_TERMS, 40);
  score -= sumTerms(hay, SOFT_TERMS, 24);
  if (INDIA_TERMS.test(title)) score += 15;
  if (US_TERMS.test(title)) score += 8;

  // Recency matters more here than for tech: visa rules change week to week, and
  // a stale deadline is worse than no post.
  const ageHours = (Date.now() - new Date(item?.pubDate).getTime()) / 3600000;
  if (Number.isFinite(ageHours)) score += Math.max(0, 40 - ageHours);

  return Math.round(score);
}

module.exports = {
  BUCKETS, INDIA_TERMS, US_TERMS, NOISE_TERMS,
  CODE_SIGNAL, AGENCY_SIGNAL, CONCEPT_SIGNAL, AUDIENCE_SIGNAL,
  matchBuckets, assess, isIndianStudentStory, scoreIndianStudentStory, mentions,
};

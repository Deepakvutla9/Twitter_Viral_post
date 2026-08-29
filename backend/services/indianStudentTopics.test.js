const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assess, isIndianStudentStory, scoreIndianStudentStory, matchBuckets,
} = require('./indianStudentTopics');

const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString();
const story = (title, extra = {}) => ({ title, summary: '', pubDate: at(1), ...extra });

// The brief for this account, as given: student visa and status, work
// authorisation, the H-1B and green card pathway, and the practical life around
// them. Kept verbatim so a change to the gate that quietly drops part of the
// beat fails here rather than on the grid.
const BRIEF = [
  'Indian students in USA', 'Indian international students USA', 'F-1 visa',
  'F-1 student status', 'F-1 visa renewal', 'F-1 visa stamping', 'F-1 visa interview',
  'F-1 visa slots India', 'US visa appointment India', 'US embassy visa interview',
  'US consulate visa interview', 'Visa interview waiver', 'Visa administrative processing',
  'Visa refusal 214(b)', 'Visa application DS-160', 'I-20 form', 'Form I-20 extension',
  'I-20 travel signature', 'SEVIS', 'SEVIS fee', 'SEVIS ID', 'SEVP-certified school',
  'Designated School Official (DSO)', 'Student and Exchange Visitor Program',
  'Full-time enrollment', 'F-1 status maintenance', 'Change of status',
  'Reinstatement of F-1 status', 'Duration of Status (D/S)', 'F-1 grace period',
  'Optional Practical Training (OPT)', 'Pre-completion OPT', 'Post-completion OPT',
  'OPT application', 'OPT processing time', 'OPT EAD card',
  'Employment Authorization Document', 'Form I-765', 'OPT unemployment days',
  'OPT reporting requirements', 'SEVP Portal', 'STEM OPT extension', '24-month STEM OPT',
  'STEM OPT employer requirements', 'E-Verify employer', 'Form I-983',
  'STEM OPT training plan', 'Curricular Practical Training (CPT)', 'CPT authorization',
  'Part-time CPT', 'Full-time CPT', 'Day 1 CPT', 'CPT internship', 'Co-op program',
  'On-campus employment', 'Off-campus employment authorization',
  'Severe economic hardship employment', 'OPT job related to major',
  'International student job search', 'US internship for Indian students',
  'H-1B visa', 'H-1B lottery', 'H-1B registration', 'H-1B cap', 'H-1B visa slots',
  'H-1B cap-subject employer', 'Cap-exempt H-1B', 'H-1B specialty occupation',
  'H-1B sponsorship', 'H-1B transfer', 'H-1B extension', 'H-1B prevailing wage',
  'Labor Condition Application (LCA)', 'H-1B Request for Evidence (RFE)',
  'H-1B premium processing', 'H-1B visa stamping India', 'H-1B consular processing',
  'H-1B change of status', 'H-1B cap-gap extension', 'OPT to H-1B transition',
  'Green card sponsorship', 'EB-2 green card', 'EB-3 green card',
  'PERM labor certification', 'Employment-based green card backlog',
  'India employment-based visa backlog', 'Visa Bulletin India', 'Priority date',
  'Adjustment of status', 'EB-1 visa', 'MS in USA for Indian students',
  'STEM degree USA', 'US university admissions', 'Graduate school application USA',
  'GRE waiver universities USA', 'TOEFL for Indian students', 'IELTS for USA universities',
  'Education loan for USA', 'Indian student loans USA', 'Cost of living for Indian students USA',
];

test('every subject in the brief is admitted', () => {
  const missed = BRIEF.filter((subject) => !isIndianStudentStory(story(subject)));
  assert.deepEqual(missed, [], 'these subjects would never reach the pool');
});

// The point of the signal model. These phrasings appear nowhere in the brief and
// nowhere in the keyword lists; they have to be recognised by shape.
test('phrasings nobody listed are still recognised', () => {
  const unlisted = [
    'DHS floats fixed terms of admission for foreign students, ending duration of status',
    'Consular officers told to widen social media vetting of applicants',
    'Form I-539 fee doubles under the new schedule',
    'Trump signs proclamation restricting entry for skilled workers',
    'Wage-weighted selection replaces the random draw for specialty occupation petitions',
    'Court blocks the parole rule for foreign graduates',
  ];
  for (const headline of unlisted) {
    const verdict = assess(story(headline));
    assert.ok(verdict.admit, `missed: ${headline} (${verdict.reasons.join(', ')})`);
  }
});

test('a form number nobody has written about yet still reads as immigration', () => {
  // The list cannot contain next year's form. The shape can.
  assert.ok(isIndianStudentStory(story('USCIS revises Form I-829 processing')));
  assert.ok(isIndianStudentStory(story('New I-912 fee waiver guidance published')));
});

test('the everyday news that shares our vocabulary stays out', () => {
  const junk = [
    'ICE hockey final draws record crowd in Boston',
    'Lottery winner in Chennai collects Rs 12 crore prize',
    'Indian cricket team announces squad for the World Cup',
    'Apple opens a new campus in Austin',
    'Iceland votes on whether to restart talks on joining EU',
    'Bengaluru startup raises $40M Series B',
    'Cost of living rises sharply in Texas',
    'Indian immigrants celebrate Diwali in New Jersey',
    'Visa-free countries for Indian passport holders in 2026',
  ];
  for (const headline of junk) {
    const verdict = assess(story(headline));
    assert.equal(verdict.admit, false, `leaked: ${headline} (${verdict.reasons.join(', ')})`);
  }
});

test('a term of art that is also an ordinary word waits for corroboration', () => {
  // Same word, two worlds. Only one of them is this account's beat.
  assert.equal(isIndianStudentStory(story('Lottery winner in Chennai collects prize')), false);
  assert.ok(isIndianStudentStory(story('Green card lottery registration dates announced')));
});

test('an immigration desk corroborates wording a general desk would not', () => {
  const headline = story('Universities warn of enrolment drop as interviews stall in Chennai');
  assert.equal(isIndianStudentStory(headline), false, 'too vague on its own');
  assert.ok(
    isIndianStudentStory(headline, { sourceIsDedicated: true }),
    'the same words from an NRI desk are about this beat',
  );
});

test('the practical-life bucket needs the journey named', () => {
  assert.equal(isIndianStudentStory(story('Education loan demand rises in Tamil Nadu')), false);
  assert.ok(isIndianStudentStory(story('Education loan costs climb for Indian students heading to the US')));
});

test('an ICE hockey headline is rejected despite naming an agency', () => {
  // Agency alone must never admit: the acronym has a life outside immigration.
  const verdict = assess(story('ICE hockey final draws record crowd'));
  assert.equal(verdict.admit, false);
  assert.ok(verdict.reasons.includes('agency'), 'the signal fired, the rule held');
});

test('a rule change outranks commentary about the same rule', () => {
  const rule = scoreIndianStudentStory(story('USCIS announces new rule on STEM OPT, effective from January'));
  const chatter = scoreIndianStudentStory(story('Founder says STEM OPT debate is overblown, shares viral Reddit post'));
  assert.ok(rule > chatter, `${rule} should beat ${chatter}`);
});

test('an India-specific story outranks the same story about elsewhere', () => {
  const india = scoreIndianStudentStory(story('Student visa delays hit Indian applicants'));
  const other = scoreIndianStudentStory(story('Student visa delays hit Brazilian applicants'));
  assert.ok(india > other);
});

test('a fresh story outranks an identical day-old one', () => {
  const fresh = scoreIndianStudentStory(story('H-1B update for Indian workers'));
  const stale = scoreIndianStudentStory(story('H-1B update for Indian workers', { pubDate: at(48) }));
  assert.ok(fresh > stale, 'visa rules change fast, so recency must count');
});

test('a story carrying only signals still ranks, rather than sitting at zero', () => {
  // No bucket keyword at all — a code and an agency. It must not be admitted and
  // then buried beneath every keyword-stuffed headline.
  const signalOnly = story('Homeland Security republishes Form I-129 with a revised edition date');
  assert.deepEqual(Object.keys(matchBuckets(signalOnly.title)), [], 'no keyword hits at all');
  assert.ok(scoreIndianStudentStory(signalOnly) > 40, 'signals have to carry weight, not just admit');
});

test('the reasons for a verdict are reported, not just the verdict', () => {
  // A rule nobody can inspect is a rule nobody can tune.
  const verdict = assess(story('USCIS raises the H-1B petition fee'));
  assert.ok(verdict.admit);
  assert.ok(verdict.reasons.length > 0);
  assert.ok(verdict.reasons.includes('agency'));
});

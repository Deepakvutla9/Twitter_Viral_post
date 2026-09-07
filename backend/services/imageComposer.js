const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const W = 1080, H = 1080;
const PAD = 60;

// Brand colors — cyan accent, NOT yellow (differentiate from competitors).
// These are the fallback for an account that has not set its own.
const ACCENT  = '#00e5ff';   // cyan highlight
const WHITE   = '#ffffff';
const BLACK   = '#000000';
const FONT    = 'Arial Black,Arial,sans-serif';
const FONT_B  = 'Arial,sans-serif';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Everything below is interpolated into raw SVG, so account-supplied branding is
// escaped and the colour is pattern-checked here as well as in accounts.js and
// in a database CHECK constraint. Three layers because an unescaped value here
// is not a broken layout, it is arbitrary markup in the rendered image.
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

function brandFor(account) {
  if (!account?.slug) {
    throw new Error('[ImageComposer] composeSlideImages requires an account (see services/accounts.js)');
  }

  let accent = account.accent;
  if (!ACCENT_RE.test(String(accent || ''))) {
    console.warn(`[ImageComposer] account "${account.slug}" has an unusable accent — falling back to ${ACCENT}`);
    accent = ACCENT;
  }

  // The badge pill used to be a fixed 290px around a hard-coded name. Any other
  // account name would have run straight out of it.
  //
  // Truncate the raw text first, then escape. Escaping first and cutting after
  // can slice through an entity — a name ending near "&" becomes "&am", which is
  // malformed XML and fails the whole render in Sharp rather than just looking
  // wrong. The width is measured on the raw text for the same reason: "&amp;" is
  // one glyph, not five.
  const rawName = String(account.displayName || account.slug).toUpperCase().slice(0, 40);
  const name = esc(rawName);
  const pillW = Math.min(640, Math.max(200, rawName.length * 13 + 56));

  // Split for the marks that stack the name over two lines, escaped the same way.
  const words = rawName.split(/\s+/).filter(Boolean).map(esc);
  const initials = words.map((w) => w[0]).join('').slice(0, 2) || '?';

  // An unknown key draws the name pill rather than nothing. A logo that silently
  // vanished would be harder to notice than one that never changed.
  let mark = account.logo ? String(account.logo).trim() : null;
  if (mark && !MARKS[mark]) {
    console.warn(`[ImageComposer] account "${account.slug}" asks for unknown logo "${mark}" — using the name pill. Known: ${MARK_NAMES.join(', ')}`);
    mark = null;
  }

  return {
    accent, name, pillW, mark, initials, nameWords: words,
    handle: esc(account.handle || `@${account.slug}`),
  };
}

// ── AUTO-HIGHLIGHT key words in the article title ─────────────────────────────
const HIGHLIGHT_WORDS = [
  'openai','google','meta','anthropic','microsoft','nvidia','apple','amazon',
  'tesla','uber','deepmind','gemini','chatgpt','gpt','claude','llm','ai',
  'billion','million','trillion','fired','layoffs','breakthrough','banned',
  'lawsuit','fined','acquired','raises','beats','surpasses','replaces',
];

function autoHighlight(title) {
  const words = title.split(/\s+/);
  return words.map(w => {
    const clean = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/\$?\d/.test(w)) return `**${w}**`;              // numbers
    if (HIGHLIGHT_WORDS.includes(clean)) return `**${w}**`; // key terms
    return w;
  }).join(' ');
}

// ── TEXT HIGHLIGHT PARSER ─────────────────────────────────────────────────────
// Parses "hello **world** today" → [{text:"hello ", hl:false},{text:"world",hl:true},{text:" today",hl:false}]
function parseSegments(raw) {
  // Normalize: remove spaces before punctuation (e.g. "small ." → "small.")
  const cleaned = String(raw).replace(/\s+([.,!?;:])/g, '$1');
  const parts = cleaned.split(/\*\*(.*?)\*\*/);
  return parts.map((p, i) => ({ text: p, hl: i % 2 === 1 })).filter(s => s.text);
}

// Choose the largest type size whose wrapped body fits the available height.
// Returns the lines plus the size that produced them. Dropping text is the last
// resort, not the first: a shrunk slide still reads, a truncated one does not.
function fitBody(rawBody, availHeight, steps, trim) {
  for (const step of steps) {
    const lines = wrapHighlighted(rawBody, step.maxChars);
    if (lines.length * step.lh <= availHeight) {
      return { lines, size: step.size, lh: step.lh, truncated: false };
    }
  }
  const smallest = steps[steps.length - 1];
  const maxLines = Math.floor(availHeight / smallest.lh);
  const all = wrapHighlighted(rawBody, smallest.maxChars);
  if (all.length <= maxLines) {
    return { lines: all, size: smallest.size, lh: smallest.lh, truncated: false };
  }
  return {
    lines: trim(rawBody, maxLines, smallest.maxChars),
    size: smallest.size,
    lh: smallest.lh,
    truncated: true,
  };
}

// Word-wrap highlighted text → array of lines, each line = [{w, hl}]
function wrapHighlighted(raw, maxChars) {
  const segments = parseSegments(raw);
  const words = [];
  for (const seg of segments) {
    const parts = seg.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i];
      // If word is only punctuation (e.g. "." "," "!") merge it onto the previous word
      if (/^[.,!?;:]+$/.test(w) && words.length > 0) {
        words[words.length - 1].w += w;
      } else {
        words.push({ w, hl: seg.hl });
      }
    }
  }
  const lines = [];
  let cur = [], len = 0;
  for (const word of words) {
    const add = (cur.length > 0 ? 1 : 0) + word.w.length;
    if (len + add > maxChars && cur.length > 0) {
      lines.push(cur); cur = [word]; len = word.w.length;
    } else {
      cur.push(word); len += add;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

// Render wrapped highlighted lines as SVG — uses xml:space="preserve" + spaces outside tspans
// to prevent SVG from stripping whitespace between words
function renderLinesSimple(lines, x, startY, lineH, fontSize, normalFill, hlFill) {
  return lines.map((line, i) => {
    const y = startY + i * lineH;
    // Group consecutive same-hl words
    const segs = [];
    let cur = null;
    for (const word of line) {
      if (!cur || cur.hl !== word.hl) { cur = { text: word.w, hl: word.hl }; segs.push(cur); }
      else cur.text += ' ' + word.w;
    }
    // Space goes OUTSIDE tspan so SVG whitespace rules don't strip it
    const tspans = segs.map((s, idx) => {
      const fill = s.hl ? hlFill : normalFill;
      const fw   = s.hl ? '900' : '700';
      const space = idx < segs.length - 1 ? ' ' : '';
      return `<tspan fill="${fill}" font-weight="${fw}">${esc(s.text)}</tspan>${space}`;
    }).join('');
    return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${fontSize}" xml:space="preserve">${tspans}</text>`;
  }).join('\n');
}

// The headline used to pick one of three sizes from the title's character count
// and then hard-cut anything past a fixed line limit — five lines at the small
// size. A six-line headline lost its last line silently, which is how
// "...study tool for students" published as "...study tool for".
//
// The limit was arbitrary rather than a real constraint: at 72px, six lines
// still leave a comfortable gap above the badge. So the line budget is now
// derived from the space actually available, and the type steps down only when
// the text genuinely needs it. Truncation is the last resort it should always
// have been, and it says so in the log when it happens.
//
// Everything above the headline has to fit too: the badge pill sits 28px above
// the tallest glyph, and the brand pill ends at y=96.
const HEAD_TOP_LIMIT = 96 + 24 + 46 + 28; // logo, gap, badge height, badge gap
const HEAD_SIZES = [96, 88, 80, 72, 64, 58, 52, 46];

function headlineSteps() {
  // 1440 keeps the character-per-line ratio the original sizes used: 15 chars at
  // 96px, 17 at 84, 20 at 72.
  return HEAD_SIZES.map((size) => ({
    size,
    lh: Math.round(size * 1.13),
    cap: Math.round(size * 0.72),
    maxChars: Math.round(1440 / size),
  }));
}

function fitHeadline(rawTitle, headBottom) {
  const ladder = headlineSteps();

  // Start where the original design put this title — a short headline is meant
  // to render large and a long one smaller, and that is a look, not a bug. The
  // ladder below only ever goes down from here, so the fix changes nothing for
  // any headline that already fitted.
  const titleLen = rawTitle.replace(/\*\*/g, '').length;
  const startSize = titleLen <= 35 ? 96 : titleLen <= 55 ? 88 : 72;
  const steps = ladder.slice(ladder.findIndex((s) => s.size === startSize));

  for (const step of steps) {
    const lines = wrapHighlighted(rawTitle, step.maxChars);
    const available = headBottom - HEAD_TOP_LIMIT - step.cap;
    const maxLines = Math.floor(available / step.lh) + 1;
    if (lines.length <= maxLines) {
      return { lines, size: step.size, lh: step.lh, truncated: false };
    }
  }

  const smallest = steps[steps.length - 1];
  const available = headBottom - HEAD_TOP_LIMIT - smallest.cap;
  const maxLines = Math.max(1, Math.floor(available / smallest.lh) + 1);
  const all = wrapHighlighted(rawTitle, smallest.maxChars);
  return {
    lines: all.slice(0, maxLines),
    size: smallest.size,
    lh: smallest.lh,
    truncated: all.length > maxLines,
  };
}

// ── SHARED ELEMENTS ───────────────────────────────────────────────────────────

/**
 * Drawn marks an account can use instead of the name pill.
 *
 * A registry of built-in designs keyed by name, not raw SVG stored per account:
 * this string is interpolated straight into the document, so markup coming from
 * configuration would be an injection rather than a logo. An account picks a key
 * and everything drawn is code in this file.
 *
 * Each takes the already-escaped brand and returns SVG for the top-left corner,
 * which must stay inside y=40..100 so the headline fitter's top limit holds.
 */
const MARKS = {
  // Initials in a solid accent tile, name stacked beside it. The only one that
  // still reads as a mark when cropped square, which is what a profile picture
  // or a story sticker needs.
  monogram: (brand) => {
    const [first, ...rest] = brand.nameWords;
    const second = rest.join(' ');
    return `
    <rect x="${PAD}" y="40" width="60" height="60" rx="16" fill="${brand.accent}"/>
    <text x="${PAD + 30}" y="82" font-family="${FONT}" font-size="30" font-weight="900"
      fill="${BLACK}" text-anchor="middle">${brand.initials}</text>
    <text x="${PAD + 76}" y="${second ? 63 : 78}" font-family="${FONT}" font-size="21"
      font-weight="900" fill="${WHITE}" letter-spacing="1.5">${first}</text>
    ${second ? `<text x="${PAD + 76}" y="90" font-family="${FONT}" font-size="21"
      font-weight="900" fill="${brand.accent}" letter-spacing="1.5">${second}</text>` : ''}`;
  },

  // Graduation cap inside the existing glass pill.
  cap: (brand) => `
    <rect x="${PAD}" y="44" width="${brand.pillW + 50}" height="52" rx="26"
      fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
    <g transform="translate(${PAD + 18},52)">
      <path d="M18 2 L36 11 L18 20 L0 11 Z" fill="${brand.accent}"/>
      <path d="M8 15 L8 25 Q18 32 28 25 L28 15" fill="none" stroke="${brand.accent}"
        stroke-width="3.4" stroke-linecap="round"/>
    </g>
    <text x="${PAD + 70}" y="79" font-family="${FONT}" font-size="19" font-weight="900"
      fill="${WHITE}" letter-spacing="2">${brand.name}</text>`,

  // Name only, against an accent rule. No pill, so it needs a dark photo.
  wordmark: (brand) => {
    const [first, ...rest] = brand.nameWords;
    const second = rest.join(' ');
    return `
    <rect x="${PAD}" y="46" width="7" height="48" rx="3.5" fill="${brand.accent}"/>
    <text x="${PAD + 22}" y="${second ? 68 : 80}" font-family="${FONT}" font-size="23"
      font-weight="900" fill="${WHITE}" letter-spacing="2">${first}</text>
    ${second ? `<text x="${PAD + 22}" y="94" font-family="${FONT}" font-size="23"
      font-weight="900" fill="${brand.accent}" letter-spacing="2">${second}</text>` : ''}`;
  },

  // Study abroad: a globe under a graduation cap. The account's two subjects —
  // studying, and doing it overseas — in one shape. Like the monogram and unlike
  // the pill marks it survives a square crop, so it doubles as a profile picture.
  // The cap is white rather than accent so it still separates from the globe on
  // an account whose accent is pale.
  globe: (brand) => {
    const [first, ...rest] = brand.nameWords;
    const second = rest.join(' ');
    return `
    <circle cx="${PAD + 30}" cy="78" r="20" fill="${brand.accent}"/>
    <line x1="${PAD + 10}" y1="78" x2="${PAD + 50}" y2="78"
      stroke="${BLACK}" stroke-width="2.2" opacity="0.5"/>
    <ellipse cx="${PAD + 30}" cy="78" rx="7.5" ry="20" fill="none"
      stroke="${BLACK}" stroke-width="2.2" opacity="0.5"/>
    <path d="M${PAD + 30} 44 L${PAD + 50} 52 L${PAD + 30} 60 L${PAD + 10} 52 Z"
      fill="${WHITE}" stroke="${BLACK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M${PAD + 47} 53 L${PAD + 47} 63" stroke="${WHITE}" stroke-width="2.4"
      stroke-linecap="round"/>
    <text x="${PAD + 76}" y="${second ? 68 : 84}" font-family="${FONT}" font-size="21"
      font-weight="900" fill="${WHITE}" letter-spacing="1.5">${first}</text>
    ${second ? `<text x="${PAD + 76}" y="92" font-family="${FONT}" font-size="21"
      font-weight="900" fill="${brand.accent}" letter-spacing="1.5">${second}</text>` : ''}`;
  },

  // Study abroad, wide form: a boarding pass. The perforation and the plane read
  // as travel at a glance where the globe needs a second look. It is a pill, so
  // it needs the width — this one cannot be cropped square.
  boarding: (brand) => `
    <rect x="${PAD}" y="44" width="${brand.pillW + 56}" height="52" rx="12"
      fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
    <g transform="translate(${PAD + 16},58)">
      <path d="M0 12 L26 0 L14 24 L11 15 Z" fill="${brand.accent}"/>
      <path d="M11 15 L26 0" stroke="${BLACK}" stroke-width="1.4" opacity="0.45"/>
    </g>
    <line x1="${PAD + 54}" y1="52" x2="${PAD + 54}" y2="88"
      stroke="rgba(255,255,255,0.35)" stroke-width="2" stroke-dasharray="4 5"/>
    <text x="${PAD + 70}" y="79" font-family="${FONT}" font-size="19" font-weight="900"
      fill="${WHITE}" letter-spacing="2">${brand.name}</text>`,

  // An initialism-led name — "YP Global" — wants the acronym itself in the tile
  // and the rest of the name beside it. The monogram cannot express that: taking
  // one letter per word turns "YP Global" into "YG", contradicting the name it
  // sits next to.
  //
  // Falls back to the monogram when the first word is too long for the tile or
  // when there is nothing left to set beside it, so the mark is safe for any
  // account that selects it rather than only for the one it was drawn for.
  //
  // head is already escaped, so an "&" in a name inflates its length to five and
  // takes the fallback. That is the safe direction to be wrong in, and a brand
  // whose acronym contains an ampersand is not the case worth complicating this
  // for.
  lockup: (brand) => {
    const [head, ...rest] = brand.nameWords;
    const tail = rest.join(' ');
    if (!tail || head.length > 4) return MARKS.monogram(brand);

    // Arial Black caps run about 0.72em and the tile has ~48px of usable width,
    // so the type steps down as the acronym gets longer instead of overflowing.
    const headSize = [34, 30, 22, 16][head.length - 1];
    const tailSize = tail.length <= 10 ? 23 : tail.length <= 16 ? 20 : 17;
    return `
    <rect x="${PAD}" y="40" width="60" height="60" rx="16" fill="${brand.accent}"/>
    <text x="${PAD + 30}" y="${Math.round(70 + headSize * 0.4)}" font-family="${FONT}"
      font-size="${headSize}" font-weight="900" fill="${BLACK}"
      text-anchor="middle">${head}</text>
    <text x="${PAD + 76}" y="${Math.round(70 + tailSize * 0.4)}" font-family="${FONT}"
      font-size="${tailSize}" font-weight="900" fill="${WHITE}"
      letter-spacing="2">${tail}</text>`;
  },
};

const MARK_NAMES = Object.keys(MARKS);

function logoSvg(brand) {
  if (brand.mark) return MARKS[brand.mark](brand);

  // Top-left: glass pill badge — page name, sized to the name it holds
  return `
    <rect x="${PAD}" y="44" width="${brand.pillW}" height="52" rx="26"
      fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
    <text x="${PAD + brand.pillW / 2}" y="79"
      font-family="${FONT}" font-size="20" font-weight="900"
      fill="${WHITE}" text-anchor="middle" letter-spacing="2">${brand.name}</text>`;
}

function socialBar(brand) {
  // Bottom bar: handle left, CTA right
  return `
    <rect x="0" y="${H - 58}" width="${W}" height="58" fill="rgba(0,0,0,0.7)"/>
    <rect x="0" y="${H - 58}" width="${W}" height="1" fill="rgba(255,255,255,0.12)"/>
    <text x="${PAD}" y="${H - 20}"
      font-family="${FONT_B}" font-size="22" font-weight="600"
      fill="rgba(255,255,255,0.55)" letter-spacing="1">${brand.handle}</text>
    <text x="${W - PAD}" y="${H - 20}"
      font-family="${FONT_B}" font-size="22" font-weight="600"
      fill="${brand.accent}" text-anchor="end" letter-spacing="1">Follow for more →</text>`;
}

// ── SLIDE 1: HOOK ─────────────────────────────────────────────────────────────
// Full photo, heavy bottom gradient, badge pill, huge headline (no teaser)
function buildHookSlide(slide, imgBase64, brand) {
  const rawTitle  = autoHighlight(slide.headline || '');
  const badge     = (slide.badge || 'NEWS').toUpperCase();

  // Background
  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad1)"/>`
    : `<rect width="${W}" height="${H}" fill="#0a0a0a"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad1Fallback)"/>`;

  const SOCIAL_TOP  = H - 58;
  // Headline anchored to bottom of slide, above social bar with comfortable padding
  const HEAD_BOTTOM = SOCIAL_TOP - 52;

  const { lines: headLines, size: HEAD_SIZE, lh: HEAD_LH, truncated } = fitHeadline(rawTitle, HEAD_BOTTOM);
  const CAP_HEIGHT   = Math.round(HEAD_SIZE * 0.72);
  const maxHeadLines = headLines.length;
  const HEAD_Y       = HEAD_BOTTOM - (maxHeadLines - 1) * HEAD_LH;

  if (truncated) {
    console.warn(`[ImageComposer] headline did not fit even at the smallest size: "${rawTitle.slice(0, 80)}"`);
  }

  // Badge clearly above glyph top (28px breathing room)
  const BADGE_H      = 46;
  const BADGE_BOTTOM = HEAD_Y - CAP_HEIGHT - 28;
  const BADGE_Y      = BADGE_BOTTOM - BADGE_H;

  // Badge pill
  const BADGE_W = badge.length * 16 + 48;
  const badgeSvg = `
    <rect x="${PAD}" y="${BADGE_Y}" width="${BADGE_W}" height="${BADGE_H}" rx="${BADGE_H / 2}"
      fill="${brand.accent}"/>
    <text x="${PAD + BADGE_W / 2}" y="${BADGE_Y + BADGE_H * 0.65}"
      font-family="${FONT}" font-size="22" font-weight="900"
      fill="${BLACK}" text-anchor="middle" letter-spacing="3">${esc(badge)}</text>`;

  // Headline — fills bottom area above social bar, no teaser
  const headSvg = renderLinesSimple(headLines.slice(0, maxHeadLines), PAD, HEAD_Y, HEAD_LH, HEAD_SIZE, WHITE, brand.accent);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
      <stop offset="42%"  stop-color="rgba(0,0,0,0)"/>
      <stop offset="56%"  stop-color="rgba(0,0,0,0.60)"/>
      <stop offset="72%"  stop-color="rgba(0,0,0,0.88)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.98)"/>
    </linearGradient>
    <linearGradient id="grad1Fallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d0d18"/>
      <stop offset="100%" stop-color="#050508"/>
    </linearGradient>
  </defs>

  ${bg}
  ${logoSvg(brand)}
  ${badgeSvg}
  ${headSvg}
  ${socialBar(brand)}
</svg>`;
}

// ── SLIDE 2: CONTEXT ──────────────────────────────────────────────────────────
// Full photo, heavy gradient, large body text with cyan highlights, max context
function buildContextSlide(slide, imgBase64, slideNum, totalSlides, brand) {
  const rawBody = slide.body || '';

  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad2)"/>`
    : `<rect width="${W}" height="${H}" fill="#080808"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad2)"/>`;

  // Body text — vertically centered with headroom + footroom
  // Body text — vertically centered with headroom + footroom.
  //
  // The context slide is written to 70-90 words, but 48px type only fits about
  // 280 characters here — roughly one sentence. The old code quietly trimmed
  // everything past that to the last complete sentence, which is why posts went
  // out reading as incomplete. Shrink the type until the WHOLE body fits
  // instead of dropping sentences; short bodies still render at full size.
  const SOCIAL_TOP   = H - 58;
  const AVAIL_TOP    = 120;
  const AVAIL_BOTTOM = SOCIAL_TOP - 40;
  const AVAIL_HEIGHT = AVAIL_BOTTOM - AVAIL_TOP;

  // maxChars tracks size: the text column is fixed, so smaller type fits more
  // characters per line. Kept proportional to the original 48px/28ch pairing.
  const BODY_STEPS = [
    { size: 48, lh: 66, maxChars: 28 },
    { size: 44, lh: 60, maxChars: 31 },
    { size: 40, lh: 55, maxChars: 34 },
    { size: 36, lh: 50, maxChars: 38 },
    { size: 32, lh: 45, maxChars: 43 },
    { size: 28, lh: 40, maxChars: 49 },
  ];

  // Trim to the last complete sentence that fits — the last resort, so a slide
  // never ends mid-thought even when the body overflows the smallest size.
  function trimToCompleteSentence(text, maxLines, maxChars) {
    const allLines = wrapHighlighted(text, maxChars);
    if (allLines.length <= maxLines) return allLines;
    const words = allLines.slice(0, maxLines).flat().map(w => w.w).join(' ');
    const match = words.match(/^(.*[.!?])\s*/s);
    if (match) return wrapHighlighted(match[1], maxChars);
    return allLines.slice(0, maxLines);
  }

  const fitted = fitBody(rawBody, AVAIL_HEIGHT, BODY_STEPS, trimToCompleteSentence);
  const bodyLines = fitted.lines;
  const BODY_SIZE = fitted.size;
  const BODY_LH   = fitted.lh;

  const blockHeight  = bodyLines.length * BODY_LH;
  const BODY_Y       = Math.round((AVAIL_TOP + AVAIL_BOTTOM - blockHeight) / 2) + BODY_LH;

  const bodySvg = renderLinesSimple(bodyLines, PAD, BODY_Y, BODY_LH, BODY_SIZE, WHITE, brand.accent);

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0.75)"/>
      <stop offset="40%"  stop-color="rgba(0,0,0,0.82)"/>
      <stop offset="70%"  stop-color="rgba(0,0,0,0.90)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.97)"/>
    </linearGradient>
  </defs>

  ${bg}
  ${bodySvg}
  ${socialBar(brand)}
</svg>`;
}

// ── IMAGE DOWNLOAD ────────────────────────────────────────────────────────────
async function fetchImageBase64(url, variant = 'slide1') {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    let pipeline = sharp(Buffer.from(res.data));

    if (variant === 'slide1') {
      // Slide 1: vivid, crop from top (show faces/subjects)
      pipeline = pipeline
        .resize(1080, 1080, { fit: 'cover', position: 'top' });
    } else {
      // Slide 2: crop from centre, darker + desaturated → feels like a different photo
      pipeline = pipeline
        .resize(1080, 1080, { fit: 'cover', position: 'centre' })
        .modulate({ brightness: 0.72, saturation: 0.45 })
        .tint({ r: 10, g: 20, b: 40 }); // subtle cool blue tint for depth
    }

    const buf = await pipeline.jpeg({ quality: 90 }).toBuffer();
    return buf.toString('base64');
  } catch (e) {
    console.log(`[ImageComposer] Thumbnail fetch failed (${variant}): ${e.message}`);
    return null;
  }
}

// ── AI BACKGROUND GENERATION ──────────────────────────────────────────────────
// Slide 2 gets an AI-generated abstract background. Two sources, tried in order:
//   1. Hugging Face Inference Providers (FLUX.1-schnell via provider "auto").
//      Needs an HF token with the "Inference Providers" permission enabled.
//   2. Pollinations.ai — free, keyless FLUX endpoint. Always-on fallback so a
//      background renders even without a working HF token.
// NOTE: the legacy api-inference.huggingface.co host was retired by HF in 2025;
// that is why the old direct-POST approach started failing with ENOTFOUND.
const HF_MODELS = ['black-forest-labs/FLUX.1-schnell'];

async function generateFromHF(prompt) {
  const token = process.env.HF_API_KEY;
  if (!token) return null;

  let InferenceClient;
  try {
    ({ InferenceClient } = await import('@huggingface/inference'));
  } catch (e) {
    console.log(`[HF] client unavailable: ${e.message}`);
    return null;
  }

  const hf = new InferenceClient(token);
  for (const model of HF_MODELS) {
    try {
      console.log(`[HF] Trying ${model} (provider auto)`);
      const blob = await hf.textToImage({
        model,
        inputs: prompt,
        parameters: { width: 1024, height: 1024 },
        provider: 'auto',
      });
      const raw = Buffer.from(await blob.arrayBuffer());
      if (raw.byteLength > 5000) {
        const buf = await sharp(raw)
          .resize(1080, 1080, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 90 }).toBuffer();
        console.log(`[HF] ✓ ${model} (${Math.round(raw.byteLength / 1024)}KB)`);
        return buf.toString('base64');
      }
    } catch (e) {
      console.log(`[HF] ${model} failed: ${e.message}`);
    }
  }
  return null;
}

async function generateFromPollinations(prompt) {
  // Keyless FLUX endpoint. Random seed so repeated topics don't collide visually.
  const seed = Math.floor(Math.random() * 1e6);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=1024&height=1024&nologo=true&model=flux&seed=${seed}`;
  try {
    console.log('[Pollinations] Trying FLUX (keyless)');
    const res = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (res.data?.byteLength > 5000) {
      const buf = await sharp(Buffer.from(res.data))
        .resize(1080, 1080, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 90 }).toBuffer();
      console.log(`[Pollinations] ✓ (${Math.round(res.data.byteLength / 1024)}KB)`);
      return buf.toString('base64');
    }
  } catch (e) {
    console.log(`[Pollinations] failed: ${e.message}`);
  }
  return null;
}

// Try HF first (better control if the token has Inference-Providers access),
// then fall back to the keyless Pollinations endpoint.
async function generateHFImage(prompt) {
  return (await generateFromHF(prompt)) || (await generateFromPollinations(prompt));
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
// Options object rather than a fifth positional argument: the account is not
// optional, and a caller that forgets it should fail loudly rather than render
// someone else's branding.
async function composeSlideImages(slides, { ogImage = null, imagePrompt = null, customSlide1Base64 = null, account } = {}) {
  const brand     = brandFor(account);
  const timestamp = Date.now();
  const results   = [];

  // Slide 1 → article's real photo (ogImage)
  // Slide 2 → HF AI-generated image (different visual, same topic)
  // Each falls back to the other if unavailable, then to null (pure dark bg)
  console.log('[ImageComposer] Fetching images in parallel...');
  const [articleSlide1, articleSlide2, hfImg] = await Promise.all([
    customSlide1Base64  ? Promise.resolve(customSlide1Base64)   // uploaded image takes priority
      : ogImage         ? fetchImageBase64(ogImage, 'slide1')   : Promise.resolve(null),
    ogImage             ? fetchImageBase64(ogImage, 'slide2')   : Promise.resolve(null),
    imagePrompt         ? generateHFImage(imagePrompt)          : Promise.resolve(null),
  ]);

  console.log(`[ImageComposer] Slide1 photo: ${articleSlide1 ? '✓' : '✗'}  |  HF image: ${hfImg ? '✓' : '✗'}`);

  // Slide 1: uploaded/article photo  |  Slide 2: HF AI image  |  Slide 3 (optional):
  // the darkened article photo for visual variety, each falling back as available.
  const slideImages = [
    articleSlide1 || hfImg,
    hfImg         || articleSlide2,
    articleSlide2 || hfImg,
  ];

  const total = slides.length;

  for (let i = 0; i < slides.length; i++) {
    const slide   = slides[i];
    const img     = slideImages[i] || null;
    let svg;

    if (slide.type === 'hook') {
      svg = buildHookSlide(slide, img, brand);
    } else {
      svg = buildContextSlide(slide, img, i + 1, total, brand);
    }

    const filename = `slide_${timestamp}_${i}.jpg`;
    const filepath = path.join(TEMP_DIR, filename);
    await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toFile(filepath);
    results.push({ filename, filepath });
    console.log(`[ImageComposer] Slide ${i + 1} (${slide.type}) → ${filename}`);
  }

  return results;
}

function cleanOldImages() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  fs.readdirSync(TEMP_DIR).forEach(f => {
    const fp = path.join(TEMP_DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
  });
}

module.exports = {
  composeSlideImages, cleanOldImages, fitBody, fitHeadline, wrapHighlighted, MARK_NAMES,
  // Exported for tests: branding is interpolated into raw SVG, so it is asserted
  // on directly rather than inferred from a rendered PNG.
  brandFor, MARKS,
  buildSocialBar: (account) => socialBar(brandFor(account)),
};

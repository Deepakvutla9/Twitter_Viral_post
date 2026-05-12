const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const W = 1080, H = 1080;
const PAD = 80;

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapLines(text, maxChars) {
  const lines = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(' ');
    let cur = '';
    for (const word of words) {
      if ((cur + ' ' + word).trim().length > maxChars) {
        if (cur) lines.push(cur.trim());
        cur = word;
      } else {
        cur = (cur + ' ' + word).trim();
      }
    }
    if (cur) lines.push(cur.trim());
  }
  return lines;
}

function fitLines(lines, startY, lineH, maxY) {
  return lines.slice(0, Math.floor((maxY - startY) / lineH));
}

// ── THEMES ────────────────────────────────────────────────────────────────────
const THEMES = [
  {
    bg:        '#080c14',
    accent:    '#00d4ff',
    accentDim: '#004d5e',
    tag:       '#00d4ff',
    numColor:  '#0a1a24',
    label:     'DID YOU KNOW',
  },
  {
    bg:        '#0a080f',
    accent:    '#a855f7',
    accentDim: '#3b0f6e',
    tag:       '#a855f7',
    numColor:  '#150a22',
    label:     'THE FULL STORY',
  },
  {
    bg:        '#080f0a',
    accent:    '#00ff88',
    accentDim: '#004d28',
    tag:       '#00ff88',
    numColor:  '#081a0e',
    label:     'THE BIG PICTURE',
  },
];

// ── SHARED ELEMENTS ───────────────────────────────────────────────────────────
function bgRect(t) {
  return `<rect width="${W}" height="${H}" fill="${t.bg}"/>`;
}

function accentBar(t) {
  // Vertical accent bar on left
  return `<rect x="0" y="0" width="8" height="${H}" fill="${t.accent}"/>`;
}

function topLine(t) {
  return `
    <rect x="8" y="0" width="${W - 8}" height="3" fill="${t.accentDim}" opacity="0.6"/>
    <rect x="8" y="0" width="200" height="3" fill="${t.accent}"/>
  `;
}

function slideNumber(num, t) {
  return `
    <text x="${W - 60}" y="${H - 60}"
      font-family="Arial Black,Arial,sans-serif"
      font-size="280" font-weight="900"
      fill="${t.numColor}"
      text-anchor="end"
      dominant-baseline="auto"
      opacity="1">${num}</text>
  `;
}

function labelTag(t, index) {
  return `
    <rect x="${PAD}" y="${PAD}" width="260" height="44" rx="4"
      fill="${t.accent}" opacity="0.12"/>
    <rect x="${PAD}" y="${PAD}" width="4" height="44"
      fill="${t.accent}"/>
    <text x="${PAD + 16}" y="${PAD + 28}"
      font-family="Arial,sans-serif"
      font-size="18" font-weight="700"
      fill="${t.accent}" letter-spacing="3">${esc(t.label)}</text>
  `;
}

function dots(active, t) {
  return [0, 1, 2].map((i) =>
    `<circle cx="${PAD + i * 22}" cy="${H - PAD + 10}" r="${i === active ? 7 : 4}"
     fill="${i === active ? t.accent : t.accentDim}" opacity="${i === active ? 1 : 0.5}"/>`
  ).join('');
}

function bottomBar(t, active) {
  const label = active === 2 ? 'FOLLOW FOR MORE AI NEWS' : 'SWIPE FOR MORE';
  return `
    <rect x="0" y="${H - 70}" width="${W}" height="70" fill="${t.bg}"/>
    <rect x="0" y="${H - 70}" width="${W}" height="1" fill="${t.accentDim}" opacity="0.4"/>
    <text x="${W - PAD}" y="${H - 30}"
      font-family="Arial,sans-serif" font-size="20" font-weight="600"
      fill="${t.accentDim}" text-anchor="end" letter-spacing="2">${esc(label)}</text>
    ${dots(active, t)}
  `;
}

function gridLines(t) {
  // Subtle grid lines for depth
  const lines = [];
  for (let x = 100; x < W; x += 180) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${t.accentDim}" stroke-width="1" opacity="0.08"/>`);
  }
  for (let y = 100; y < H; y += 180) {
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${t.accentDim}" stroke-width="1" opacity="0.08"/>`);
  }
  return lines.join('');
}

function cornerDeco(t) {
  return `
    <rect x="${W - 120}" y="0" width="120" height="120"
      fill="none" stroke="${t.accent}" stroke-width="1" opacity="0.15"/>
    <rect x="${W - 80}" y="0" width="80" height="80"
      fill="none" stroke="${t.accent}" stroke-width="1" opacity="0.1"/>
  `;
}

// ── SLIDE BUILDER ─────────────────────────────────────────────────────────────
function buildSlide(slide, t, index) {
  const SAFE_BOTTOM = H - 90;
  const CONTENT_LEFT = PAD + 20;
  const CONTENT_WIDTH = W - CONTENT_LEFT - PAD;

  // Headline
  const HEAD_Y = 220;
  const HEAD_FONT = index === 0 ? 78 : 68;
  const HEAD_LINE_H = index === 0 ? 90 : 82;
  const HEAD_MAX_CHARS = 18;

  const headLines = fitLines(wrapLines(slide.headline, HEAD_MAX_CHARS), HEAD_Y, HEAD_LINE_H, SAFE_BOTTOM - 220);

  const headSvg = headLines.map((l, i) =>
    `<text x="${CONTENT_LEFT}" y="${HEAD_Y + i * HEAD_LINE_H}"
     font-family="Arial Black,Arial,sans-serif"
     font-size="${HEAD_FONT}" font-weight="900"
     fill="#FFFFFF" letter-spacing="-1">${esc(l)}</text>`
  ).join('\n');

  // Accent line under headline
  const accentLineY = HEAD_Y + headLines.length * HEAD_LINE_H + 10;
  const accentLine = `
    <rect x="${CONTENT_LEFT}" y="${accentLineY}" width="80" height="3" rx="1" fill="${t.accent}"/>
    <rect x="${CONTENT_LEFT + 90}" y="${accentLineY}" width="30" height="3" rx="1" fill="${t.accent}" opacity="0.3"/>
  `;

  // Body text
  const BODY_Y = accentLineY + 36;
  const BODY_FONT = 36;
  const BODY_LINE_H = 50;
  const BODY_MAX_CHARS = 38;

  const bodyLines = fitLines(wrapLines(slide.body, BODY_MAX_CHARS), BODY_Y, BODY_LINE_H, SAFE_BOTTOM);

  const bodySvg = bodyLines.map((l, i) =>
    `<text x="${CONTENT_LEFT}" y="${BODY_Y + i * BODY_LINE_H}"
     font-family="Arial,sans-serif"
     font-size="${BODY_FONT}" font-weight="400"
     fill="rgba(200,216,240,0.85)">${esc(l)}</text>`
  ).join('\n');

  const numLabel = String(index + 1).padStart(2, '0');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  ${bgRect(t)}
  ${gridLines(t)}
  ${slideNumber(numLabel, t)}
  ${cornerDeco(t)}
  ${accentBar(t)}
  ${topLine(t)}
  ${labelTag(t, index)}

  ${headSvg}
  ${accentLine}
  ${bodySvg}

  ${bottomBar(t, index)}
</svg>`;
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
async function composeSlideImages(slides) {
  const timestamp = Date.now();
  const results = [];

  for (let i = 0; i < slides.length; i++) {
    const t = THEMES[i % THEMES.length];
    const svg = buildSlide(slides[i], t, i);
    const filename = `slide_${timestamp}_${i}.jpg`;
    const filepath = path.join(TEMP_DIR, filename);
    await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toFile(filepath);
    results.push({ filename, filepath });
    console.log(`[ImageComposer] Slide ${i + 1} → ${filename}`);
  }

  return results;
}

function cleanOldImages() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  fs.readdirSync(TEMP_DIR).forEach((f) => {
    const fp = path.join(TEMP_DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
  });
}

module.exports = { composeSlideImages, cleanOldImages };

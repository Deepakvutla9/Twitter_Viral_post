const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const THEMES = [
  { g1: '#6C00FF', g2: '#BC00DD', g3: '#FF006E', tag: '#FFE156' },
  { g1: '#0052D4', g2: '#4364F7', g3: '#6FB1FC', tag: '#FFE156' },
  { g1: '#F7971E', g2: '#E84545', g3: '#C0392B', tag: '#FFFFFF' },
];

const W = 1080, H = 1080;
const PADDING = 90;
const RIGHT_LIMIT = W - 90;   // text wrap must stay within this
const BOTTOM_BAR_H = 90;
const SAFE_BOTTOM = H - BOTTOM_BAR_H - 30;

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

// Fit as many lines as possible without exceeding safeBottom
function fitLines(lines, startY, lineH, safeBottom) {
  const maxLines = Math.floor((safeBottom - startY) / lineH);
  return lines.slice(0, maxLines);
}

function slideDots(active) {
  return [0, 1, 2].map((i) =>
    `<circle cx="${500 + i * 30}" cy="${H - 42}" r="${i === active ? 9 : 6}"
     fill="rgba(255,255,255,${i === active ? '1' : '0.35'})"/>`
  ).join('');
}

function bottomBar(index) {
  const label = index === 2
    ? 'FOLLOW FOR DAILY AI NEWS  🤖'
    : 'SWIPE FOR MORE  →';
  return `
    <rect x="0" y="${H - BOTTOM_BAR_H}" width="${W}" height="${BOTTOM_BAR_H}" fill="rgba(0,0,0,0.30)"/>
    <text x="${PADDING}" y="${H - 28}"
      font-family="Arial,sans-serif" font-size="26" font-weight="600"
      fill="rgba(255,255,255,0.55)" letter-spacing="1">${esc(label)}</text>
    ${slideDots(index)}`;
}

function decoCircles() {
  return `
    <circle cx="${W + 120}" cy="-120" r="420" fill="rgba(255,255,255,0.06)"/>
    <circle cx="${W - 40}"  cy="${H + 100}" r="300" fill="rgba(255,255,255,0.05)"/>
    <circle cx="-100" cy="${H - 60}" r="220" fill="rgba(255,255,255,0.04)"/>`;
}

// ── SLIDE 1 ──────────────────────────────────────────────────────────────────
function slide1(slide, t) {
  const HEAD_FONT  = 80;
  const HEAD_LINE_H = 92;
  const BODY_FONT  = 38;
  const BODY_LINE_H = 52;

  // Title block starts at y=60
  const TITLE_Y   = 100;   // "DID YOU KNOW?" baseline
  const HEAD_Y    = 220;   // headline starts here

  const headLines = fitLines(wrapLines(slide.headline, 18), HEAD_Y, HEAD_LINE_H, SAFE_BOTTOM - 200);
  const bodyStartY = HEAD_Y + headLines.length * HEAD_LINE_H + 40;
  const bodyLines  = fitLines(wrapLines(slide.body, 38), bodyStartY, BODY_LINE_H, SAFE_BOTTOM);

  const headSvg = headLines.map((l, i) =>
    `<text x="${PADDING}" y="${HEAD_Y + i * HEAD_LINE_H}"
     font-family="Arial Black,Arial,sans-serif"
     font-size="${HEAD_FONT}" font-weight="900" fill="#FFFFFF"
     filter="url(#ts)">${esc(l)}</text>`
  ).join('\n');

  const bodySvg = bodyLines.map((l, i) =>
    `<text x="${PADDING}" y="${bodyStartY + i * BODY_LINE_H}"
     font-family="Arial,sans-serif"
     font-size="${BODY_FONT}" font-weight="400"
     fill="rgba(255,255,255,0.90)">${esc(l)}</text>`
  ).join('\n');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${t.g1}"/>
      <stop offset="50%"  stop-color="${t.g2}"/>
      <stop offset="100%" stop-color="${t.g3}"/>
    </linearGradient>
    <filter id="ts">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${decoCircles()}

  <!-- DID YOU KNOW brand -->
  <text x="${PADDING}" y="${TITLE_Y}"
    font-family="Arial Black,Arial,sans-serif"
    font-size="50" font-weight="900" letter-spacing="5"
    fill="${t.tag}">${esc('DID YOU KNOW?')}</text>
  <rect x="${PADDING}" y="${TITLE_Y + 12}" width="440" height="4" rx="2"
    fill="${t.tag}" opacity="0.55"/>

  ${headSvg}
  ${bodySvg}
  ${bottomBar(0)}
</svg>`;
}

// ── SLIDE 2 ──────────────────────────────────────────────────────────────────
function slide2(slide, t) {
  const HEAD_FONT   = 70;
  const HEAD_LINE_H = 84;
  const BODY_FONT   = 38;
  const BODY_LINE_H = 54;

  const HEAD_Y    = 170;
  const headLines = fitLines(wrapLines(slide.headline, 20), HEAD_Y, HEAD_LINE_H, SAFE_BOTTOM - 260);
  const bodyStartY = HEAD_Y + headLines.length * HEAD_LINE_H + 44;
  const bodyLines  = fitLines(wrapLines(slide.body, 38), bodyStartY, BODY_LINE_H, SAFE_BOTTOM);

  const headSvg = headLines.map((l, i) =>
    `<text x="${PADDING}" y="${HEAD_Y + i * HEAD_LINE_H}"
     font-family="Arial Black,Arial,sans-serif"
     font-size="${HEAD_FONT}" font-weight="900" fill="#FFFFFF"
     filter="url(#ts2)">${esc(l)}</text>`
  ).join('\n');

  const bodySvg = bodyLines.map((l, i) =>
    `<text x="${PADDING}" y="${bodyStartY + i * BODY_LINE_H}"
     font-family="Arial,sans-serif"
     font-size="${BODY_FONT}" fill="rgba(255,255,255,0.92)">${esc(l)}</text>`
  ).join('\n');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${t.g1}"/>
      <stop offset="50%"  stop-color="${t.g2}"/>
      <stop offset="100%" stop-color="${t.g3}"/>
    </linearGradient>
    <filter id="ts2">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg2)"/>
  ${decoCircles()}


  ${headSvg}

  ${bodySvg}
  ${bottomBar(1)}
</svg>`;
}

// ── SLIDE 3 ──────────────────────────────────────────────────────────────────
function slide3(slide, t) {
  const HEAD_FONT   = 70;
  const HEAD_LINE_H = 84;
  const BODY_FONT   = 38;
  const BODY_LINE_H = 54;

  const HEAD_Y    = 170;
  const headLines = fitLines(wrapLines(slide.headline, 20), HEAD_Y, HEAD_LINE_H, SAFE_BOTTOM - 260);
  const bodyStartY = HEAD_Y + headLines.length * HEAD_LINE_H + 44;
  const bodyLines  = fitLines(wrapLines(slide.body, 38), bodyStartY, BODY_LINE_H, SAFE_BOTTOM);

  const headSvg = headLines.map((l, i) =>
    `<text x="${PADDING}" y="${HEAD_Y + i * HEAD_LINE_H}"
     font-family="Arial Black,Arial,sans-serif"
     font-size="${HEAD_FONT}" font-weight="900" fill="#FFFFFF"
     filter="url(#ts3)">${esc(l)}</text>`
  ).join('\n');

  const bodySvg = bodyLines.map((l, i) =>
    `<text x="${PADDING}" y="${bodyStartY + i * BODY_LINE_H}"
     font-family="Arial,sans-serif"
     font-size="${BODY_FONT}" fill="rgba(255,255,255,0.92)">${esc(l)}</text>`
  ).join('\n');

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${t.g1}"/>
      <stop offset="50%"  stop-color="${t.g2}"/>
      <stop offset="100%" stop-color="${t.g3}"/>
    </linearGradient>
    <filter id="ts3">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg3)"/>
  ${decoCircles()}

  ${headSvg}
  ${bodySvg}
  ${bottomBar(2)}
</svg>`;
}

const BUILDERS = [slide1, slide2, slide3];

async function composeSlideImages(slides) {
  const timestamp = Date.now();
  const results = [];
  for (let i = 0; i < slides.length; i++) {
    const t = THEMES[i % THEMES.length];
    const svg = BUILDERS[i % BUILDERS.length](slides[i], t);
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

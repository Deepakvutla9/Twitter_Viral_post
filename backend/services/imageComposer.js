const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const W = 1080, H = 1080;
const PAD = 60;

// Brand colors — cyan accent, NOT yellow (differentiate from competitors)
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
  const parts = String(raw).split(/\*\*(.*?)\*\*/);
  return parts.map((p, i) => ({ text: p, hl: i % 2 === 1 })).filter(s => s.text);
}

// Word-wrap highlighted text → array of lines, each line = [{w, hl}]
function wrapHighlighted(raw, maxChars) {
  const segments = parseSegments(raw);
  const words = [];
  for (const seg of segments) {
    for (const w of seg.text.split(/\s+/).filter(Boolean)) {
      words.push({ w, hl: seg.hl });
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

// Render wrapped highlighted lines as SVG text elements
function renderLines(lines, x, startY, lineH, fontSize, normalFill, hlFill, bold = false) {
  return lines.map((line, i) => {
    const y = startY + i * lineH;
    const segs = [];
    let cur = null;
    for (const word of line) {
      if (!cur || cur.hl !== word.hl) { cur = { text: word.w, hl: word.hl }; segs.push(cur); }
      else cur.text += ' ' + word.w;
    }
    const tspans = segs.map(s =>
      `<tspan fill="${s.hl ? hlFill : normalFill}" font-weight="${s.hl || bold ? '900' : '400'}">${esc(s.text)} </tspan>`
    ).join('');
    return `<text x="${x}" y="${y}" font-family="${s => s.hl ? FONT : FONT_B}" font-size="${fontSize}">${tspans}</text>`;
  }).join('\n');
}

// Simpler version — whole line uses same font family
function renderLinesSimple(lines, x, startY, lineH, fontSize, normalFill, hlFill) {
  return lines.map((line, i) => {
    const y = startY + i * lineH;
    const segs = [];
    let cur = null;
    for (const word of line) {
      if (!cur || cur.hl !== word.hl) { cur = { text: word.w, hl: word.hl }; segs.push(cur); }
      else cur.text += ' ' + word.w;
    }
    const tspans = segs.map(s =>
      `<tspan fill="${s.hl ? hlFill : normalFill}" font-weight="${s.hl ? '900' : '700'}">${esc(s.text)} </tspan>`
    ).join('');
    return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${fontSize}">${tspans}</text>`;
  }).join('\n');
}

// ── SHARED ELEMENTS ───────────────────────────────────────────────────────────

function logoSvg() {
  // Top-left: glass pill badge "CAROUSEL.AI"
  return `
    <rect x="${PAD}" y="44" width="220" height="52" rx="26"
      fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
    <text x="${PAD + 110}" y="79"
      font-family="${FONT}" font-size="20" font-weight="900"
      fill="${WHITE}" text-anchor="middle" letter-spacing="2">CAROUSEL.AI</text>`;
}

function socialBar() {
  // Bottom bar: handle left, website right
  return `
    <rect x="0" y="${H - 58}" width="${W}" height="58" fill="rgba(0,0,0,0.7)"/>
    <rect x="0" y="${H - 58}" width="${W}" height="1" fill="rgba(255,255,255,0.12)"/>
    <text x="${PAD}" y="${H - 20}"
      font-family="${FONT_B}" font-size="22" font-weight="600"
      fill="rgba(255,255,255,0.55)" letter-spacing="1">@carousel.ai</text>
    <text x="${W - PAD}" y="${H - 20}"
      font-family="${FONT_B}" font-size="22" font-weight="600"
      fill="rgba(255,255,255,0.55)" text-anchor="end" letter-spacing="1">carousel.ai</text>`;
}

// ── SLIDE 1: HOOK ─────────────────────────────────────────────────────────────
// Full photo, heavy bottom gradient, badge pill, huge headline, teaser line
function buildHookSlide(slide, imgBase64) {
  const rawTitle  = autoHighlight(slide.headline || '');
  const teaser    = slide.teaser || 'The full story →';
  const badge     = (slide.badge || 'NEWS').toUpperCase();

  // Background
  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad1)"/>`
    : `<rect width="${W}" height="${H}" fill="#0a0a0a"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad1Fallback)"/>`;

  // Badge pill
  const BADGE_Y = 680;
  const BADGE_W = badge.length * 16 + 48;
  const badgeSvg = `
    <rect x="${PAD}" y="${BADGE_Y}" width="${BADGE_W}" height="46" rx="23"
      fill="${ACCENT}"/>
    <text x="${PAD + BADGE_W / 2}" y="${BADGE_Y + 30}"
      font-family="${FONT}" font-size="22" font-weight="900"
      fill="${BLACK}" text-anchor="middle" letter-spacing="3">${esc(badge)}</text>`;

  // Headline — large, mixed white/cyan
  const HEAD_Y    = BADGE_Y + 80;
  const HEAD_SIZE = 88;
  const HEAD_LH   = 96;
  const HEAD_MAX  = 18;
  const headLines = wrapHighlighted(rawTitle, HEAD_MAX);
  const maxHeadLines = Math.min(headLines.length, 3);
  const headSvg = renderLinesSimple(headLines.slice(0, maxHeadLines), PAD, HEAD_Y, HEAD_LH, HEAD_SIZE, WHITE, ACCENT);

  // Teaser
  const teaserY = HEAD_Y + maxHeadLines * HEAD_LH + 20;
  const teaserSvg = `
    <text x="${PAD}" y="${teaserY}"
      font-family="${FONT_B}" font-size="34" font-weight="700"
      fill="rgba(255,255,255,0.80)">${esc(teaser)}</text>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
      <stop offset="42%"  stop-color="rgba(0,0,0,0.15)"/>
      <stop offset="65%"  stop-color="rgba(0,0,0,0.80)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.97)"/>
    </linearGradient>
    <linearGradient id="grad1Fallback" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d0d18"/>
      <stop offset="100%" stop-color="#050508"/>
    </linearGradient>
  </defs>

  ${bg}
  ${logoSvg()}
  ${badgeSvg}
  ${headSvg}
  ${teaserSvg}
  ${socialBar()}
</svg>`;
}

// ── SLIDE 2: CONTEXT ──────────────────────────────────────────────────────────
// Full photo, heavy gradient, large body text with cyan highlights, slide counter
function buildContextSlide(slide, imgBase64, slideNum, totalSlides) {
  const rawBody = slide.body || '';

  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad2)"/>`
    : `<rect width="${W}" height="${H}" fill="#080808"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad2)"/>`;

  // Slide counter top-right
  const counter = `
    <text x="${W - PAD}" y="82"
      font-family="${FONT}" font-size="28" font-weight="900"
      fill="rgba(255,255,255,0.70)" text-anchor="end"
      letter-spacing="2">${slideNum}/${totalSlides}</text>`;

  // Body text — large, with cyan highlights
  const BODY_SIZE = 52;
  const BODY_LH   = 68;
  const BODY_MAX  = 30;
  const BODY_Y    = 510;
  const MAX_LINES = Math.floor((H - 80 - BODY_Y) / BODY_LH);

  const bodyLines = wrapHighlighted(rawBody, BODY_MAX).slice(0, MAX_LINES);
  const bodySvg   = renderLinesSimple(bodyLines, PAD, BODY_Y, BODY_LH, BODY_SIZE, WHITE, ACCENT);

  // Arrow
  const arrowY = BODY_Y + bodyLines.length * BODY_LH + 28;
  const arrow  = arrowY < H - 80
    ? `<text x="${PAD}" y="${arrowY}" font-family="${FONT}" font-size="48" font-weight="900" fill="${WHITE}">→</text>`
    : '';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
      <stop offset="38%"  stop-color="rgba(0,0,0,0.20)"/>
      <stop offset="58%"  stop-color="rgba(0,0,0,0.88)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.98)"/>
    </linearGradient>
  </defs>

  ${bg}
  ${logoSvg()}
  ${counter}
  ${bodySvg}
  ${arrow}
  ${socialBar()}
</svg>`;
}

// ── IMAGE DOWNLOAD ────────────────────────────────────────────────────────────
async function fetchImageBase64(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const buf = await sharp(Buffer.from(res.data))
      .resize(1080, 1080, { fit: 'cover', position: 'top' })
      .jpeg({ quality: 90 }).toBuffer();
    return buf.toString('base64');
  } catch (e) {
    console.log(`[ImageComposer] Thumbnail fetch failed: ${e.message}`);
    return null;
  }
}

// ── HF IMAGE GENERATION ───────────────────────────────────────────────────────
const HF_MODELS = [
  'black-forest-labs/FLUX.1-schnell',
  'stabilityai/stable-diffusion-xl-base-1.0',
  'runwayml/stable-diffusion-v1-5',
];

async function generateHFImage(prompt) {
  const token = process.env.HF_API_KEY;
  if (!token) return null;

  for (const model of HF_MODELS) {
    try {
      console.log(`[HF] Trying ${model}`);
      const res = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        { inputs: prompt, parameters: { width: 1024, height: 1024 } },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer', timeout: 60000,
        }
      );
      if (res.data?.byteLength > 5000) {
        const buf = await sharp(Buffer.from(res.data))
          .resize(1080, 1080, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 90 }).toBuffer();
        console.log(`[HF] ✓ ${model} (${Math.round(res.data.byteLength / 1024)}KB)`);
        return buf.toString('base64');
      }
    } catch (e) {
      const msg = e.response?.data ? Buffer.from(e.response.data).toString('utf8').slice(0, 100) : e.message;
      console.log(`[HF] ${model} failed: ${msg}`);
      if (e.response?.status === 503) {
        await new Promise(r => setTimeout(r, 10000));
        try {
          const retry = await axios.post(
            `https://api-inference.huggingface.co/models/${model}`,
            { inputs: prompt, parameters: { width: 1024, height: 1024 } },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 60000 }
          );
          if (retry.data?.byteLength > 5000) {
            const buf = await sharp(Buffer.from(retry.data)).resize(1080, 1080, { fit: 'cover', position: 'centre' }).jpeg({ quality: 90 }).toBuffer();
            return buf.toString('base64');
          }
        } catch {}
      }
    }
  }
  return null;
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
async function composeSlideImages(slides, ogImage = null, imagePrompt = null) {
  const timestamp = Date.now();
  const results   = [];

  // Get background image: HF first → article thumbnail → null (pure dark bg)
  let imgBase64 = null;
  if (imagePrompt) {
    console.log(`[ImageComposer] HF generating: "${imagePrompt}"`);
    imgBase64 = await generateHFImage(imagePrompt);
  }
  if (!imgBase64 && ogImage) {
    imgBase64 = await fetchImageBase64(ogImage);
  }

  const total = slides.length;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    let svg;

    if (slide.type === 'hook') {
      svg = buildHookSlide(slide, imgBase64);
    } else {
      svg = buildContextSlide(slide, imgBase64, i + 1, total);
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

module.exports = { composeSlideImages, cleanOldImages };

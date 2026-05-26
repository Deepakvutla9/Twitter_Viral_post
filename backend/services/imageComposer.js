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
  // Normalize: remove spaces before punctuation (e.g. "small ." → "small.")
  const cleaned = String(raw).replace(/\s+([.,!?;:])/g, '$1');
  const parts = cleaned.split(/\*\*(.*?)\*\*/);
  return parts.map((p, i) => ({ text: p, hl: i % 2 === 1 })).filter(s => s.text);
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

// ── SHARED ELEMENTS ───────────────────────────────────────────────────────────

function logoSvg() {
  // Top-left: glass pill badge — page name
  return `
    <rect x="${PAD}" y="44" width="290" height="52" rx="26"
      fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
    <text x="${PAD + 145}" y="79"
      font-family="${FONT}" font-size="20" font-weight="900"
      fill="${WHITE}" text-anchor="middle" letter-spacing="2">SYNTHETIC MINDS</text>`;
}

function socialBar() {
  // Bottom bar: handle left, CTA right
  return `
    <rect x="0" y="${H - 58}" width="${W}" height="58" fill="rgba(0,0,0,0.7)"/>
    <rect x="0" y="${H - 58}" width="${W}" height="1" fill="rgba(255,255,255,0.12)"/>
    <text x="${PAD}" y="${H - 20}"
      font-family="${FONT_B}" font-size="22" font-weight="600"
      fill="rgba(255,255,255,0.55)" letter-spacing="1">@shadesofirony</text>
    <text x="${W - PAD}" y="${H - 20}"
      font-family="${FONT_B}" font-size="22" font-weight="600"
      fill="${ACCENT}" text-anchor="end" letter-spacing="1">Follow for more →</text>`;
}

// ── SLIDE 1: HOOK ─────────────────────────────────────────────────────────────
// Full photo, heavy bottom gradient, badge pill, huge headline (no teaser)
function buildHookSlide(slide, imgBase64) {
  const rawTitle  = autoHighlight(slide.headline || '');
  const badge     = (slide.badge || 'NEWS').toUpperCase();

  // Background
  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad1)"/>`
    : `<rect width="${W}" height="${H}" fill="#0a0a0a"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad1Fallback)"/>`;

  // Adaptive font size so full title always fits
  // Short title → big font / fewer lines; long title → smaller font / more lines
  const titleLen = rawTitle.replace(/\*\*/g, '').length;
  const HEAD_SIZE = titleLen <= 35 ? 96 : titleLen <= 55 ? 84 : 72;
  const HEAD_LH   = Math.round(HEAD_SIZE * 1.13);
  const HEAD_MAX  = titleLen <= 35 ? 15 : titleLen <= 55 ? 17 : 20;
  const MAX_LINES = titleLen <= 35 ? 3 : titleLen <= 55 ? 4 : 5;
  const CAP_HEIGHT = Math.round(HEAD_SIZE * 0.72);

  const SOCIAL_TOP  = H - 58;
  // Headline anchored to bottom of slide, above social bar with comfortable padding
  const HEAD_BOTTOM = SOCIAL_TOP - 52;

  // Pre-wrap to know actual line count
  const headLines    = wrapHighlighted(rawTitle, HEAD_MAX);
  const maxHeadLines = Math.min(headLines.length, MAX_LINES);
  const HEAD_Y       = HEAD_BOTTOM - (maxHeadLines - 1) * HEAD_LH;

  // Badge clearly above glyph top (28px breathing room)
  const BADGE_H      = 46;
  const BADGE_BOTTOM = HEAD_Y - CAP_HEIGHT - 28;
  const BADGE_Y      = BADGE_BOTTOM - BADGE_H;

  // Badge pill
  const BADGE_W = badge.length * 16 + 48;
  const badgeSvg = `
    <rect x="${PAD}" y="${BADGE_Y}" width="${BADGE_W}" height="${BADGE_H}" rx="${BADGE_H / 2}"
      fill="${ACCENT}"/>
    <text x="${PAD + BADGE_W / 2}" y="${BADGE_Y + BADGE_H * 0.65}"
      font-family="${FONT}" font-size="22" font-weight="900"
      fill="${BLACK}" text-anchor="middle" letter-spacing="3">${esc(badge)}</text>`;

  // Headline — fills bottom area above social bar, no teaser
  const headSvg = renderLinesSimple(headLines.slice(0, maxHeadLines), PAD, HEAD_Y, HEAD_LH, HEAD_SIZE, WHITE, ACCENT);

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
  ${logoSvg()}
  ${badgeSvg}
  ${headSvg}
  ${socialBar()}
</svg>`;
}

// ── SLIDE 2: CONTEXT ──────────────────────────────────────────────────────────
// Full photo, heavy gradient, large body text with cyan highlights, max context
function buildContextSlide(slide, imgBase64, slideNum, totalSlides) {
  const rawBody = slide.body || '';

  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad2)"/>`
    : `<rect width="${W}" height="${H}" fill="#080808"/>
       <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grad2)"/>`;

  // Body text — vertically centered with headroom + footroom
  const BODY_SIZE  = 48;
  const BODY_LH    = 66;
  const BODY_MAX   = 28;
  const MAX_LINES  = 10;

  // Trim body to last complete sentence that fits within MAX_LINES
  function trimToCompleteSentence(text, maxLines, maxChars) {
    const allLines = wrapHighlighted(text, maxChars);
    if (allLines.length <= maxLines) return allLines;
    // Join words from first maxLines lines, then cut at last sentence-ending punctuation
    const words = allLines.slice(0, maxLines).flat().map(w => w.w).join(' ');
    const match = words.match(/^(.*[.!?])\s*/s);
    if (match) {
      return wrapHighlighted(match[1], maxChars);
    }
    return allLines.slice(0, maxLines);
  }

  const bodyLines = trimToCompleteSentence(rawBody, MAX_LINES, BODY_MAX);

  // Center the block vertically between top padding (120px) and social bar
  const SOCIAL_TOP   = H - 58;
  const AVAIL_TOP    = 120;
  const AVAIL_BOTTOM = SOCIAL_TOP - 40;
  const blockHeight  = bodyLines.length * BODY_LH;
  const BODY_Y       = Math.round((AVAIL_TOP + AVAIL_BOTTOM - blockHeight) / 2) + BODY_LH;

  const bodySvg = renderLinesSimple(bodyLines, PAD, BODY_Y, BODY_LH, BODY_SIZE, WHITE, ACCENT);

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
  ${socialBar()}
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
async function composeSlideImages(slides, ogImage = null, imagePrompt = null, customSlide1Base64 = null) {
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

  // Slide 1: uploaded/article photo  |  Slide 2: HF AI image, else dark fallback
  const slideImages = [
    articleSlide1 || hfImg,
    hfImg         || articleSlide2,
  ];

  const total = slides.length;

  for (let i = 0; i < slides.length; i++) {
    const slide   = slides[i];
    const img     = slideImages[i] || null;
    let svg;

    if (slide.type === 'hook') {
      svg = buildHookSlide(slide, img);
    } else {
      svg = buildContextSlide(slide, img, i + 1, total);
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

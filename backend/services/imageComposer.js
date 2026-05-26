const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── HUGGING FACE IMAGE GENERATION ─────────────────────────────────────────────
// Models tried in order — falls back if one fails or is cold-starting
const HF_MODELS = [
  'black-forest-labs/FLUX.1-schnell',       // best quality, fast
  'stabilityai/stable-diffusion-xl-base-1.0', // reliable fallback
  'runwayml/stable-diffusion-v1-5',          // last resort
];

async function generateHFImage(prompt) {
  const token = process.env.HF_API_KEY;
  if (!token) {
    console.log('[HF] No HF_API_KEY — skipping AI image generation');
    return null;
  }

  for (const model of HF_MODELS) {
    try {
      console.log(`[HF] Trying model: ${model}`);
      const res = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        { inputs: prompt, parameters: { width: 1024, height: 1024 } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 60000, // 60s — cold starts can be slow
        }
      );

      // HF returns image bytes directly
      if (res.data && res.data.byteLength > 5000) {
        console.log(`[HF] ✓ Image generated with ${model} (${Math.round(res.data.byteLength / 1024)}KB)`);
        // Resize to 1080x1080
        const buf = await sharp(Buffer.from(res.data))
          .resize(1080, 1080, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 90 })
          .toBuffer();
        return buf.toString('base64');
      }
    } catch (e) {
      const msg = e.response?.data
        ? Buffer.from(e.response.data).toString('utf8').slice(0, 120)
        : e.message;
      console.log(`[HF] Model ${model} failed: ${msg}`);
      // If model is loading (503), wait 10s and retry same model once
      if (e.response?.status === 503) {
        console.log('[HF] Model loading, waiting 10s...');
        await new Promise(r => setTimeout(r, 10000));
        try {
          const retry = await axios.post(
            `https://api-inference.huggingface.co/models/${model}`,
            { inputs: prompt, parameters: { width: 1024, height: 1024 } },
            {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              responseType: 'arraybuffer',
              timeout: 60000,
            }
          );
          if (retry.data && retry.data.byteLength > 5000) {
            const buf = await sharp(Buffer.from(retry.data))
              .resize(1080, 1080, { fit: 'cover', position: 'centre' })
              .jpeg({ quality: 90 })
              .toBuffer();
            console.log(`[HF] ✓ Retry succeeded for ${model}`);
            return buf.toString('base64');
          }
        } catch {}
      }
    }
  }

  console.log('[HF] All models failed — falling back to article thumbnail');
  return null;
}

const W = 1080, H = 1080;
const CYAN   = '#00e5ff';
const CYAN2  = '#00b4cc';
const WHITE  = '#ffffff';
const BLACK  = '#000000';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrapLines(text, maxChars) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    let cur = '';
    for (const w of raw.split(' ')) {
      if ((cur + ' ' + w).trim().length > maxChars) {
        if (cur) out.push(cur.trim());
        cur = w;
      } else {
        cur = (cur + ' ' + w).trim();
      }
    }
    if (cur) out.push(cur.trim());
  }
  return out;
}

// ── SHARED DEFS ───────────────────────────────────────────────────────────────
const DEFS = `
  <defs>
    <!-- headline glow -->
    <filter id="glow" x="-20%" y="-40%" width="140%" height="180%">
      <feGaussianBlur stdDeviation="14" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <!-- soft drop shadow -->
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="rgba(0,0,0,0.8)"/>
    </filter>
    <!-- noise grain overlay -->
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4"
        stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
      <feBlend in="SourceGraphic" in2="grayNoise" mode="overlay" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>
    <!-- bottom photo gradient — starts transparent, goes fully black -->
    <linearGradient id="photoGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(0,0,0,0)"/>
      <stop offset="40%"  stop-color="rgba(0,0,0,0.75)"/>
      <stop offset="75%"  stop-color="rgba(0,0,0,0.93)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,1)"/>
    </linearGradient>
    <!-- fallback bg gradient -->
    <linearGradient id="fallbackGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#07080f"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <!-- text shelf vignette -->
    <radialGradient id="shelfGlow" cx="50%" cy="100%" r="70%">
      <stop offset="0%"   stop-color="${CYAN}" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="${CYAN}" stop-opacity="0"/>
    </radialGradient>
    <!-- cyan line glow -->
    <filter id="lineGlow" x="-100%" y="-200%" width="300%" height="500%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <!-- text bg dark radial -->
    <radialGradient id="textBgGrad" cx="30%" cy="30%" r="80%">
      <stop offset="0%"   stop-color="#111318"/>
      <stop offset="100%" stop-color="#050507"/>
    </radialGradient>
  </defs>`;

// ── SLIDE 1: PHOTO HOOK ───────────────────────────────────────────────────────
// Magazine-cover style: vivid photo, heavy bottom gradient, editorial headline
function buildPhotoSlide(slide, imgBase64) {
  const headline = (slide.headline || '').toUpperCase();
  const subheadline = slide.subheadline || '';

  // ── Background layers
  const bg = imgBase64
    ? `<image href="data:image/jpeg;base64,${imgBase64}"
         x="0" y="0" width="${W}" height="${H}"
         preserveAspectRatio="xMidYMid slice"/>
       <!-- gradient ONLY on bottom 45% for text readability — photo fully visible above -->
       <rect x="0" y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="url(#photoGrad)"/>
       <!-- ambient cyan shelf glow -->
       <rect x="0" y="${H * 0.6}" width="${W}" height="${H * 0.4}"
         fill="url(#shelfGlow)"/>`
    : `<rect width="${W}" height="${H}" fill="url(#fallbackGrad)"/>
       <rect x="0" y="${H * 0.5}" width="${W}" height="${H * 0.5}"
         fill="url(#shelfGlow)"/>`;

  // ── Left accent bar (full height, glowing)
  const accentBar = `
    <rect x="0" y="0" width="5" height="${H}" fill="${CYAN}" filter="url(#lineGlow)"/>
    <rect x="0" y="0" width="5" height="${H}" fill="${CYAN}"/>`;

  // ── Top-right: glass source badge
  const SOURCE_X = W - 260, SOURCE_Y = 44, BW = 220, BH = 52;
  const sourceBadge = `
    <rect x="${SOURCE_X}" y="${SOURCE_Y}" width="${BW}" height="${BH}" rx="26"
      fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
    <text x="${SOURCE_X + BW / 2}" y="${SOURCE_Y + 34}"
      font-family="Arial,sans-serif" font-size="22" font-weight="700"
      fill="rgba(255,255,255,0.8)" text-anchor="middle" letter-spacing="3">
      CAROUSEL.AI</text>`;

  // ── Eyebrow: "AI NEWS" tag
  const eyebrowY = 620;
  const eyebrow = `
    <rect x="72" y="${eyebrowY - 32}" width="140" height="38" rx="4"
      fill="${CYAN}" opacity="0.12"/>
    <rect x="72" y="${eyebrowY - 32}" width="3" height="38" fill="${CYAN}"/>
    <text x="84" y="${eyebrowY - 4}"
      font-family="Arial,sans-serif" font-size="22" font-weight="800"
      fill="${CYAN}" letter-spacing="4">AI NEWS</text>`;

  // ── Headline — large, white, ultra-bold with glow
  const headLines = wrapLines(headline, 19);
  const HEAD_FONT = headLines.length >= 3 ? 82 : headLines.length === 2 ? 92 : 100;
  const HEAD_LINE_H = HEAD_FONT * 1.08;
  const headStartY = eyebrowY + 74;

  const headSvg = `
    <g filter="url(#shadow)">
      ${headLines.map((l, i) =>
        `<text x="72" y="${headStartY + i * HEAD_LINE_H}"
          font-family="Arial Black,Arial,sans-serif"
          font-size="${HEAD_FONT}" font-weight="900"
          fill="${WHITE}" letter-spacing="-2">${esc(l)}</text>`
      ).join('\n')}
    </g>`;

  // ── Cyan accent rule below headline
  const ruleY = headStartY + headLines.length * HEAD_LINE_H + 18;
  const rule = `
    <rect x="72" y="${ruleY}" width="60" height="3" rx="1.5" fill="${CYAN}"/>
    <rect x="142" y="${ruleY}" width="20" height="3" rx="1.5"
      fill="${CYAN}" opacity="0.35"/>`;

  // ── Subheadline — cyan, punchy
  const subLines = wrapLines(subheadline, 44);
  const subStartY = ruleY + 52;
  const subSvg = subLines.slice(0, 2).map((l, i) =>
    `<text x="72" y="${subStartY + i * 48}"
      font-family="Arial,sans-serif" font-size="38" font-weight="700"
      fill="${CYAN}">${esc(l)}</text>`
  ).join('\n');

  // ── Bottom-right brand
  const brand = `
    <text x="${W - 68}" y="${H - 36}"
      font-family="Arial,sans-serif" font-size="20" font-weight="600"
      fill="rgba(255,255,255,0.4)" text-anchor="end" letter-spacing="2">
      carousel.ai</text>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${DEFS}
  ${bg}
  ${accentBar}
  ${sourceBadge}
  ${eyebrow}
  ${headSvg}
  ${rule}
  ${subSvg}
  ${brand}
</svg>`;
}

// ── SLIDE 2: EDITORIAL TEXT CARD ──────────────────────────────────────────────
// Near-black bg, ghost number depth element, pill label, dramatic title, clean body
function buildTextSlide(slide) {
  const PAD = 80;
  const title = slide.title || '';
  const label = (slide.label || 'KEY FACTS').replace(/:$/, '').toUpperCase();
  const body  = slide.body || '';

  // ── Background: dark radial
  const bg = `
    <rect width="${W}" height="${H}" fill="url(#textBgGrad)"/>
    <!-- subtle horizontal scan lines for depth -->
    <rect width="${W}" height="${H}" fill="rgba(0,229,255,0.012)"
      style="mask: url(#scanMask)"/>`;

  // ── Ghost "01" behind everything — massive, near-invisible
  const ghost = `
    <text x="${W - 20}" y="${H + 60}"
      font-family="Arial Black,Arial,sans-serif"
      font-size="580" font-weight="900"
      fill="rgba(255,255,255,0.032)"
      text-anchor="end" dominant-baseline="auto">01</text>`;

  // ── Left accent bar with glow
  const accentBar = `
    <rect x="0" y="0" width="5" height="${H}" fill="${CYAN}" filter="url(#lineGlow)"/>
    <rect x="0" y="0" width="5" height="${H}" fill="${CYAN}"/>`;

  // ── Horizontal top accent line
  const topLine = `
    <rect x="5" y="0" width="220" height="3" fill="${CYAN}"/>
    <rect x="225" y="0" width="${W - 225}" height="3"
      fill="${CYAN2}" opacity="0.15"/>`;

  // ── Label pill
  const PILL_Y = 64;
  const PILL_W = label.length * 14 + 48;
  const labelPill = `
    <rect x="${PAD}" y="${PILL_Y}" width="${PILL_W}" height="44" rx="22"
      fill="${CYAN}" opacity="0.12" stroke="${CYAN}" stroke-width="1" stroke-opacity="0.5"/>
    <text x="${PAD + PILL_W / 2}" y="${PILL_Y + 29}"
      font-family="Arial,sans-serif" font-size="21" font-weight="800"
      fill="${CYAN}" text-anchor="middle" letter-spacing="3">${esc(label)}</text>`;

  // ── Title — large, bold, white
  const titleStartY = PILL_Y + 44 + 60;
  const TITLE_FONT  = 74;
  const TITLE_LINE_H = 86;
  const titleLines  = wrapLines(title, 20);

  const titleSvg = titleLines.map((l, i) =>
    `<text x="${PAD}" y="${titleStartY + i * TITLE_LINE_H}"
      font-family="Arial Black,Arial,sans-serif"
      font-size="${TITLE_FONT}" font-weight="900"
      fill="${WHITE}">${esc(l)}</text>`
  ).join('\n');

  // ── Separator line
  const sepY = titleStartY + titleLines.length * TITLE_LINE_H + 36;
  const sep = `
    <rect x="${PAD}" y="${sepY}" width="${W - PAD * 2}" height="1"
      fill="${CYAN}" opacity="0.2"/>
    <rect x="${PAD}" y="${sepY}" width="80" height="1" fill="${CYAN}" opacity="0.8"/>`;

  // ── Body text
  const BODY_Y      = sepY + 56;
  const BODY_FONT   = 38;
  const BODY_LINE_H = 58;
  const MAX_CHARS   = 38;
  const MAX_Y       = H - 90;

  const bodyLines = wrapLines(body, MAX_CHARS)
    .slice(0, Math.floor((MAX_Y - BODY_Y) / BODY_LINE_H));

  const bodySvg = bodyLines.map((l, i) =>
    `<text x="${PAD}" y="${BODY_Y + i * BODY_LINE_H}"
      font-family="Arial,sans-serif" font-size="${BODY_FONT}" font-weight="400"
      fill="rgba(210,220,235,0.88)">${esc(l)}</text>`
  ).join('\n');

  // ── Bottom bar
  const bottomBar = `
    <rect x="0" y="${H - 62}" width="${W}" height="62"
      fill="rgba(0,0,0,0.45)"/>
    <rect x="0" y="${H - 62}" width="${W}" height="1"
      fill="${CYAN}" opacity="0.15"/>
    <text x="${PAD}" y="${H - 22}"
      font-family="Arial,sans-serif" font-size="20" font-weight="700"
      fill="${CYAN}" letter-spacing="3" opacity="0.7">CAROUSEL.AI</text>
    <text x="${W - PAD}" y="${H - 22}"
      font-family="Arial,sans-serif" font-size="20" font-weight="600"
      fill="rgba(255,255,255,0.35)" text-anchor="end" letter-spacing="2">
      FOLLOW FOR MORE</text>`;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${DEFS}
  ${bg}
  ${ghost}
  ${accentBar}
  ${topLine}
  ${labelPill}
  ${titleSvg}
  ${sep}
  ${bodySvg}
  ${bottomBar}
</svg>`;
}

// ── IMAGE DOWNLOAD ────────────────────────────────────────────────────────────
async function fetchImageBase64(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const buf = await sharp(Buffer.from(res.data))
      .resize(1080, 1080, { fit: 'cover', position: 'top' })
      .jpeg({ quality: 90 })
      .toBuffer();
    return buf.toString('base64');
  } catch (e) {
    console.log(`[ImageComposer] Image fetch failed: ${e.message}`);
    return null;
  }
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
async function composeSlideImages(slides, ogImage = null, imagePrompt = null) {
  const timestamp = Date.now();
  const results   = [];

  // 1. Try HF AI image generation first
  // 2. Fall back to article thumbnail
  // 3. Fall back to pure SVG design
  let imgBase64 = null;
  if (imagePrompt) {
    console.log(`[ImageComposer] Generating AI image: "${imagePrompt}"`);
    imgBase64 = await generateHFImage(imagePrompt);
  }
  if (!imgBase64 && ogImage) {
    console.log('[ImageComposer] Using article thumbnail as background');
    imgBase64 = await fetchImageBase64(ogImage);
  }

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const svg   = slide.type === 'hook'
      ? buildPhotoSlide(slide, imgBase64)
      : buildTextSlide(slide);

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
  fs.readdirSync(TEMP_DIR).forEach((f) => {
    const fp = path.join(TEMP_DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
  });
}

module.exports = { composeSlideImages, cleanOldImages };

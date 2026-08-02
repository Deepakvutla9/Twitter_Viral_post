const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://graph.instagram.com/v19.0';
const IG_HOST = 'https://graph.instagram.com'; // refresh endpoint is un-versioned
const ENV_PATH = path.join(__dirname, '..', '.env');

function getCredentials() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!accessToken || !userId) throw new Error('Instagram credentials not configured in .env');
  return { accessToken, userId };
}

// Turn a raw Graph API axios error into a clear, actionable Error.
function graphError(e, step) {
  const err = e.response?.data?.error;
  if (err) {
    // code 190 = expired / invalid OAuth token — the #1 cause of posting stopping.
    if (err.code === 190) {
      return new Error(
        `Instagram access token is expired or invalid (${step}). Long-lived tokens last ` +
        `~60 days and must be regenerated: Meta app → Instagram → generate a new ` +
        `long-lived token, then update INSTAGRAM_ACCESS_TOKEN in backend/.env. ` +
        `(Graph says: "${err.message}")`,
      );
    }
    return new Error(`Instagram API error (${step}) [${err.code}]: ${err.message}`);
  }
  return new Error(`Instagram request failed (${step}): ${e.message}`);
}

// Read-only health check: confirms the token is still valid without posting.
// Returns { ok, username } or { ok:false, error }.
async function checkToken() {
  try {
    const { accessToken, userId } = getCredentials();
    const res = await axios.get(`${BASE_URL}/${userId}`, {
      params: { fields: 'id,username,account_type', access_token: accessToken },
    });
    return { ok: true, ...res.data };
  } catch (e) {
    return { ok: false, error: graphError(e, 'token check').message };
  }
}

// Rewrite just the INSTAGRAM_ACCESS_TOKEN line in backend/.env, leaving the
// rest of the file untouched, and update the in-memory value too.
function persistTokenToEnv(newToken) {
  try {
    let s = fs.readFileSync(ENV_PATH, 'utf8');
    if (/^INSTAGRAM_ACCESS_TOKEN=.*$/m.test(s)) {
      s = s.replace(/^INSTAGRAM_ACCESS_TOKEN=.*$/m, `INSTAGRAM_ACCESS_TOKEN=${newToken}`);
    } else {
      s += `${s.endsWith('\n') ? '' : '\n'}INSTAGRAM_ACCESS_TOKEN=${newToken}\n`;
    }
    fs.writeFileSync(ENV_PATH, s);
    process.env.INSTAGRAM_ACCESS_TOKEN = newToken;
    return true;
  } catch (e) {
    console.warn(`[Instagram] could not persist refreshed token to .env: ${e.message}`);
    return false;
  }
}

// Extend the long-lived Instagram User token for another ~60 days and save it.
// Instagram Login (IGAA…) tokens refresh via graph.instagram.com/refresh_access_token.
// Safe to call repeatedly; a no-op failure here never blocks posting.
async function refreshToken() {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accessToken) return { ok: false, error: 'no token set' };
  try {
    const res = await axios.get(`${IG_HOST}/refresh_access_token`, {
      params: { grant_type: 'ig_refresh_token', access_token: accessToken },
    });
    const { access_token, expires_in } = res.data;
    if (!access_token) return { ok: false, error: 'no access_token in refresh response' };
    const persisted = persistTokenToEnv(access_token);
    const days = Math.round((expires_in || 0) / 86400);
    console.log(`[Instagram] ♻ Token refreshed — valid ~${days} more days${persisted ? '' : ' (WARNING: not saved to .env)'}`);
    return { ok: true, days, persisted };
  } catch (e) {
    return { ok: false, error: graphError(e, 'refresh token').message };
  }
}

// Upload image to catbox.moe (free, no auth, permanent hosting)
async function uploadImageToHost(filepath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filepath));
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });
  const url = res.data.trim();
  console.log(`[Instagram] Uploaded image → ${url}`);
  return url;
}

// Create a single carousel item container (not published on its own)
async function createCarouselItem(imageUrl) {
  const { accessToken, userId } = getCredentials();
  try {
    const res = await axios.post(`${BASE_URL}/${userId}/media`, null, {
      params: {
        image_url: imageUrl,
        media_type: 'IMAGE',
        is_carousel_item: true,
        access_token: accessToken,
      },
    });
    return res.data.id;
  } catch (e) {
    throw graphError(e, 'create carousel item');
  }
}

// Create the carousel album container
async function createCarouselContainer(childIds, caption) {
  const { accessToken, userId } = getCredentials();
  try {
    const res = await axios.post(`${BASE_URL}/${userId}/media`, null, {
      params: {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: accessToken,
      },
    });
    return res.data.id;
  } catch (e) {
    throw graphError(e, 'create carousel container');
  }
}

// Publish the carousel
async function publishMedia(containerId) {
  const { accessToken, userId } = getCredentials();
  try {
    const res = await axios.post(`${BASE_URL}/${userId}/media_publish`, null, {
      params: {
        creation_id: containerId,
        access_token: accessToken,
      },
    });
    return res.data.id;
  } catch (e) {
    throw graphError(e, 'publish');
  }
}

async function postCarousel(imagePaths, caption) {
  console.log(`[Instagram] Uploading ${imagePaths.length} images...`);

  // Upload all images to public host
  const imageUrls = [];
  for (const fp of imagePaths) {
    const url = await uploadImageToHost(fp);
    imageUrls.push(url);
  }

  // Create individual carousel item containers
  const childIds = [];
  for (const url of imageUrls) {
    const id = await createCarouselItem(url);
    childIds.push(id);
    console.log(`[Instagram] Carousel item created: ${id}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Create carousel container
  const carouselId = await createCarouselContainer(childIds, caption);
  console.log(`[Instagram] Carousel container: ${carouselId}`);

  // Wait before publishing (Instagram recommendation)
  await new Promise((r) => setTimeout(r, 3000));

  const postId = await publishMedia(carouselId);
  console.log(`[Instagram] Published carousel: ${postId}`);
  return postId;
}

module.exports = { postCarousel, checkToken, refreshToken };

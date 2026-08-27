const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { getSupabase } = require('./supabase');
const { resolveToken, storeToken } = require('./tokens');

const BASE_URL = 'https://graph.instagram.com/v19.0';
const IG_HOST = 'https://graph.instagram.com'; // refresh endpoint is un-versioned
const ENV_PATH = path.join(__dirname, '..', '.env');

// Every function here takes the account it is acting for. Nothing reads
// process.env for a credential: an account object arrives from accounts.js
// already validated, and its token comes from ig_tokens. That is the whole
// point of the refactor — publishing to the wrong account should be impossible
// to do by forgetting an argument.
function requireAccount(account, fn) {
  if (!account?.slug || !account?.igUserId) {
    throw new Error(`[Instagram] ${fn} requires a normalized account (see services/accounts.js)`);
  }
  return account;
}

async function credentialsFor(account, fn) {
  requireAccount(account, fn);
  const { token } = await resolveToken(account);
  return { accessToken: token, userId: account.igUserId };
}

// Turn a raw Graph API axios error into a clear, actionable Error.
function graphError(e, step, account) {
  const who = account?.handle || account?.slug || 'account';
  const err = e.response?.data?.error;
  if (err) {
    // code 190 = expired / invalid OAuth token — the #1 cause of posting stopping.
    if (err.code === 190) {
      return new Error(
        `Instagram access token for ${who} is expired or invalid (${step}). Long-lived ` +
        `tokens last ~60 days and are refreshed automatically, but a password change ` +
        `or a revoked session kills them outright. Regenerate it in the Meta app and ` +
        `update the ig_tokens row for "${account?.slug}". (Graph says: "${err.message}")`,
      );
    }
    return new Error(`Instagram API error for ${who} (${step}) [${err.code}]: ${err.message}`);
  }
  return new Error(`Instagram request failed for ${who} (${step}): ${e.message}`);
}

// Read-only health check: confirms the token is still valid without posting.
async function checkToken(account) {
  try {
    const { accessToken, userId } = await credentialsFor(account, 'checkToken');
    const res = await axios.get(`${BASE_URL}/${userId}`, {
      params: { fields: 'id,username,account_type', access_token: accessToken },
    });
    return { ok: true, slug: account.slug, ...res.data };
  } catch (e) {
    const msg = e.response ? graphError(e, 'token check', account).message : e.message;
    return { ok: false, slug: account?.slug, error: msg };
  }
}

// Rewrite just the INSTAGRAM_ACCESS_TOKEN line in backend/.env. Only used when
// there is no database to persist to — a purely local run. On the host this is
// pointless anyway, since the filesystem does not survive a restart.
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

/**
 * Extend the long-lived token for another ~60 days and store it.
 *
 * The store is a compare-and-set. If another refresh for the same account
 * committed while this one was in flight, this one loses and adopts the winner's
 * token rather than overwriting it — two valid tokens can exist at once, but only
 * the one in the database is the one everything else will read.
 */
async function refreshToken(account) {
  requireAccount(account, 'refreshToken');
  let current;
  try {
    current = await resolveToken(account);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  let res;
  try {
    res = await axios.get(`${IG_HOST}/refresh_access_token`, {
      params: { grant_type: 'ig_refresh_token', access_token: current.token },
    });
  } catch (e) {
    return { ok: false, error: graphError(e, 'refresh token', account).message };
  }

  const { access_token, expires_in } = res.data || {};
  if (!access_token) return { ok: false, error: 'no access_token in refresh response' };

  const days = Math.round((expires_in || 0) / 86400);
  const expiresAt = expires_in
    ? new Date(Date.now() + expires_in * 1000).toISOString()
    : null;

  if (!getSupabase()) {
    // No database: legacy local behaviour, and only for the account whose token
    // actually lives in .env.
    const persisted = current.source === 'env-fallback' ? persistTokenToEnv(access_token) : false;
    return { ok: true, days, token: access_token, persisted, won: true };
  }

  const stored = await storeToken(account, access_token, {
    expiresAt,
    expectedVersion: current.version,
  });

  if (!stored.won) {
    console.log(
      `[Instagram] ♻ Refresh for ${account.slug} lost a race with a concurrent ` +
      'refresh — using the token already stored.',
    );
    return { ok: true, days, token: stored.token, persisted: true, won: false };
  }

  console.log(`[Instagram] ♻ Token for ${account.slug} refreshed — valid ~${days} more days`);
  return { ok: true, days, token: access_token, persisted: true, won: true };
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
async function createCarouselItem(imageUrl, creds, account) {
  try {
    const res = await axios.post(`${BASE_URL}/${creds.userId}/media`, null, {
      params: {
        image_url: imageUrl,
        media_type: 'IMAGE',
        is_carousel_item: true,
        access_token: creds.accessToken,
      },
    });
    return res.data.id;
  } catch (e) {
    throw graphError(e, 'create carousel item', account);
  }
}

// Create the carousel album container
async function createCarouselContainer(childIds, caption, creds, account) {
  try {
    const res = await axios.post(`${BASE_URL}/${creds.userId}/media`, null, {
      params: {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: creds.accessToken,
      },
    });
    return res.data.id;
  } catch (e) {
    throw graphError(e, 'create carousel container', account);
  }
}

// Publish the carousel
async function publishMedia(containerId, creds, account) {
  try {
    const res = await axios.post(`${BASE_URL}/${creds.userId}/media_publish`, null, {
      params: { creation_id: containerId, access_token: creds.accessToken },
    });
    return res.data.id;
  } catch (e) {
    throw graphError(e, 'publish', account);
  }
}

async function postCarousel(imagePaths, caption, account) {
  requireAccount(account, 'postCarousel');
  // Resolved once and passed down, so a token refresh partway through cannot
  // publish half a carousel under one credential and half under another.
  const creds = await credentialsFor(account, 'postCarousel');

  console.log(`[Instagram] Uploading ${imagePaths.length} images for ${account.handle}...`);

  const imageUrls = [];
  for (const fp of imagePaths) {
    imageUrls.push(await uploadImageToHost(fp));
  }

  const childIds = [];
  for (const url of imageUrls) {
    const id = await createCarouselItem(url, creds, account);
    childIds.push(id);
    console.log(`[Instagram] Carousel item created: ${id}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const carouselId = await createCarouselContainer(childIds, caption, creds, account);
  console.log(`[Instagram] Carousel container: ${carouselId}`);

  // Wait before publishing (Instagram recommendation)
  await new Promise((r) => setTimeout(r, 3000));

  const postId = await publishMedia(carouselId, creds, account);
  console.log(`[Instagram] Published carousel for ${account.handle}: ${postId}`);
  return postId;
}

module.exports = { postCarousel, checkToken, refreshToken };

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { cleanOldImages } = require('./services/imageComposer');
const { autoResume } = require('./services/scheduler');
const { postCarousel, checkToken, refreshToken } = require('./services/instagram');
const postQueue = require('./services/postQueue');
const { assertProductionSafe, isServiceRole } = require('./services/supabase');
const { getAccount, listActiveAccounts } = require('./services/accounts');

const scrapeRoutes         = require('./routes/scrape');
const generateRoutes       = require('./routes/generate');
const generateCustomRoutes = require('./routes/generateCustom');
const instagramRoutes      = require('./routes/instagram');
const schedulerRoutes      = require('./routes/scheduler');
const trendingRoutes       = require('./routes/trending');
const queueRoutes          = require('./routes/queue');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Serve generated slide images
app.use('/temp', express.static(path.join(__dirname, 'temp')));

app.use('/api/scrape', scrapeRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/generate-custom', generateCustomRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/queue', queueRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── QUEUE PROCESSOR — runs every 60 seconds ───────────────────────────────────
async function processQueue() {
  const due = postQueue.getPending();
  for (const item of due) {
    console.log(`[Queue] Firing scheduled post: "${item.title}" (id=${item.id})`);
    try {
      // Queue items predate multi-account and carry no slug yet; they run as
      // the default account until the queue itself records one.
      const account = await getAccount(item.accountSlug || undefined);
      await postCarousel(item.imagePaths, item.caption, account);
      postQueue.updateStatus(item.id, 'posted');
      console.log(`[Queue] ✓ Posted: ${item.id}`);
    } catch (e) {
      postQueue.updateStatus(item.id, 'failed', e.message);
      console.log(`[Queue] ✗ Failed: ${item.id} — ${e.message}`);
    }
  }
}

setInterval(processQueue, 60 * 1000);

// Clean old temp images every hour
setInterval(cleanOldImages, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
// Keep the long-lived Instagram token alive. Instagram User tokens last ~60
// days; refreshing extends them another ~60, so as long as the server runs at
// least monthly the token never lapses. Runs on startup and every 7 days.
async function keepTokenFresh() {
  let accounts;
  try {
    accounts = await listActiveAccounts();
  } catch (e) {
    console.warn(`[Instagram] ⚠ could not list accounts: ${e.message}`);
    return;
  }

  // One account's dead token must not stop the others being kept alive.
  for (const account of accounts) {
    const tok = await checkToken(account);
    if (!tok.ok) {
      console.warn(`[Instagram] ⚠ TOKEN PROBLEM for ${account.slug} — posts will fail until fixed:\n           ${tok.error}`);
      continue;
    }
    console.log(`[Instagram] Token OK — posting as @${tok.username} (${account.slug})`);
    const refreshed = await refreshToken(account);
    if (!refreshed.ok) console.warn(`[Instagram] token refresh skipped for ${account.slug}: ${refreshed.error}`);
  }
}

setInterval(keepTokenFresh, 7 * 24 * 60 * 60 * 1000); // weekly

// Refuse to start on the anon key in production rather than discovering it as
// missing configuration in the middle of a scheduled run.
assertProductionSafe();

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`[Supabase] ${isServiceRole() ? 'service-role key' : 'anon key / no database'}`);
  await keepTokenFresh();
  autoResume();
});

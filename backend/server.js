require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { cleanOldImages } = require('./services/imageComposer');
const { autoResume } = require('./services/scheduler');
const { postCarousel } = require('./services/instagram');
const postQueue = require('./services/postQueue');
const { assertProductionSafe, isServiceRole } = require('./services/supabase');
const { getAccount } = require('./services/accounts');
const { keepTokensFresh } = require('./services/tokenMaintenance');
const { requireApiKey } = require('./middleware/auth');

const scrapeRoutes         = require('./routes/scrape');
const generateRoutes       = require('./routes/generate');
const generateCustomRoutes = require('./routes/generateCustom');
const instagramRoutes      = require('./routes/instagram');
const schedulerRoutes      = require('./routes/scheduler');
const trendingRoutes       = require('./routes/trending');
const queueRoutes          = require('./routes/queue');
const accountRoutes        = require('./routes/accounts');

const app = express();
// An allowlist once there is a key worth stealing. Left open when unset so a
// local frontend still works, but production says so out loud rather than
// quietly serving every origin.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((o) => o.trim()).filter(Boolean);
if (!allowedOrigins.length && process.env.NODE_ENV === 'production') {
  console.warn(
    '[CORS] ALLOWED_ORIGINS is unset — every origin may call this API. ' +
    'Set it to the frontend URL.',
  );
}
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-trigger-secret'],
}));
app.use(express.json());

// Serve generated slide images
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// The scheduler router is mounted unauthenticated because two of its routes
// carry their own credentials or none by design: /trigger checks the trigger
// secret itself, and /status is polled by the scheduled workflow. The routes
// inside it that a person drives apply requireApiKey individually.
app.use('/api/scheduler', schedulerRoutes);

// Everything below either publishes, spends model credit, or names which
// account to act as. None of it should be reachable without a key.
app.use('/api/scrape', requireApiKey, scrapeRoutes);
app.use('/api/generate', requireApiKey, generateRoutes);
app.use('/api/generate-custom', requireApiKey, generateCustomRoutes);
app.use('/api/instagram', requireApiKey, instagramRoutes);
app.use('/api/trending', requireApiKey, trendingRoutes);
app.use('/api/queue', requireApiKey, queueRoutes);
app.use('/api/accounts', requireApiKey, accountRoutes);

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

// Runs on startup and every 7 days. See services/tokenMaintenance.js.
setInterval(keepTokensFresh, 7 * 24 * 60 * 60 * 1000); // weekly

// Refuse to start on the anon key in production rather than discovering it as
// missing configuration in the middle of a scheduled run.
assertProductionSafe();

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`[Supabase] ${isServiceRole() ? 'service-role key' : 'anon key / no database'}`);
  await keepTokensFresh();
  autoResume();
});

const cron = require('node-cron');
const { fetchNewsArticle, fetchTrendingArticle, fetchVisaArticle, fetchTrumpArticle, markPosted } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');
const { getAccount } = require('./accounts');

let activeJob = null;

// Set REQUIRE_QUALITY=false to publish regardless of the score.
const REQUIRE_QUALITY = process.env.REQUIRE_QUALITY !== 'false';

const SOURCES = ['tech', 'visa', 'trump'];
// Which pool each of the four daily slots (00/06/12/18 UTC) draws from.
// Visa gets two slots because it is the primary brief; tech and Trump get one
// each. Override with SLOT_PLAN, e.g. SLOT_PLAN=trump,visa,trump,tech
const DEFAULT_SLOT_PLAN = ['tech', 'visa', 'trump', 'visa'];
function slotPlan() {
  const raw = process.env.SLOT_PLAN;
  if (!raw) return DEFAULT_SLOT_PLAN;
  const parsed = raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => SOURCES.includes(s));
  if (!parsed.length) {
    console.warn(`[Scheduler] ignoring invalid SLOT_PLAN: ${raw}`);
    return DEFAULT_SLOT_PLAN;
  }
  return parsed;
}
/**
 * Chooses which pool this run draws from, so one account can carry tech, visa
 * and Trump news without any of them crowding the others out.
 *
 * Derived from the clock rather than a rotating counter on purpose: the
 * free-tier instance sleeps and restarts constantly, so an in-memory index
 * would reset to the same value every run and only ever pick one source.
 * Keying off the 6-hour block also means a late-firing cron or a manual run
 * inside the same window picks the same source instead of flipping.
 *
 * CONTENT_SOURCE=tech|visa|trump pins it for manual runs.
 */
function pickSource(now = new Date()) {
  const forced = process.env.CONTENT_SOURCE;
  if (SOURCES.includes(forced)) return forced;
  const plan = slotPlan();
  return plan[Math.floor(now.getUTCHours() / 6) % plan.length];
}

// The external GitHub Actions trigger and the in-process cron both aim at the
// same 09:00/18:00 slots. If the instance happens to be awake when the cron
// fires, both would run and we'd double-post. This guard keeps only the first
// one in any 30-minute window; manual runs from the UI pass force:true.
const MIN_GAP_MS = 30 * 60 * 1000;
let lastStartedAt = 0;
let inFlight = false;

let jobStatus = {
  running: false,
  schedule: null,
  lastRun: null,
  lastResult: null,
  nextTopic: 'HN Trending',
  totalPosted: 0,
};

async function runPipeline({ force = false } = {}) {
  if (inFlight) {
    console.log('[Pipeline] Skipped — a run is already in flight');
    return { success: false, skipped: true, reason: 'in-flight' };
  }
  if (!force && Date.now() - lastStartedAt < MIN_GAP_MS) {
    const mins = Math.round((Date.now() - lastStartedAt) / 60000);
    console.log(`[Pipeline] Skipped — last run started ${mins}m ago (double-fire guard)`);
    return { success: false, skipped: true, reason: 'debounced' };
  }

  lastStartedAt = Date.now();
  inFlight = true;
  jobStatus.lastRun = new Date().toISOString();

  try {
    // Resolved up front so a broken account fails before any scraping, model
    // call or image render happens. Fan-out across accounts comes later; this
    // run still targets the default one.
    const account = await getAccount();

    const source = pickSource();
    console.log(`[Pipeline] Source for this run: ${source} (as ${account.handle})`);

    // Visa news falls back to the tech pool rather than failing the slot — a
    // missed post is worse than an off-topic one, and the feeds occasionally
    // have nothing new that clears the dedupe.
    // A themed pool falls back to tech rather than failing the slot: a missed
    // post is worse than an off-topic one, and the feeds occasionally have
    // nothing new that clears the dedupe.
    const FETCHERS = { visa: fetchVisaArticle, trump: fetchTrumpArticle };
    let article;
    if (FETCHERS[source]) {
      try {
        article = await FETCHERS[source]();
      } catch (err) {
        console.warn(`[Pipeline] ${source} pool empty (${err.message}) — falling back to tech.`);
        article = await fetchTrendingArticle();
      }
    } else {
      article = await fetchTrendingArticle();
    }
    console.log(`[Pipeline] Selected: "${article.title}" (${article.points} pts, ${article.category || 'tech'})`);

    const { slides, caption, imagePrompt, quality } = await generateCarouselSlides(article, article.title);
    const words = quality?.checks?.bodyWordCount ?? 0;
    console.log(`[Pipeline] Generated ${slides.length} slides — quality ${quality?.score ?? '?'}/100, ${words}-word context slide`);

    // The scoring existed but only the manual UI ever saw it, so autopilot
    // happily published one-sentence context slides that read as broken posts.
    // An Instagram post cannot be edited after publishing: failing this run is
    // recoverable, a thin carousel sitting on the grid is not.
    if (REQUIRE_QUALITY && !quality?.checks?.bodyLengthOk) {
      throw new Error(
        `Content too thin to publish — context slide is ${words} words, needs 70-115. ` +
        (quality?.warnings || []).join(' '),
      );
    }

    // Pass imagePrompt so slide 2 gets an AI background (HF → Pollinations),
    // falling back to the darkened article photo — matches the generate route.
    const images = await composeSlideImages(slides, article.ogImage || null, imagePrompt || null);
    const imagePaths = images.map((i) => i.filepath);

    const postId = await postCarousel(imagePaths, caption, account);
    await markPosted(article.url);
    jobStatus.totalPosted++;

    const result = {
      success: true,
      postId,
      topic: article.title,
      article: article.title,
      postedAt: new Date().toISOString(),
    };
    jobStatus.lastResult = result;

    console.log(`[Pipeline] Posted: ${postId} (total: ${jobStatus.totalPosted})`);
    return result;
  } finally {
    inFlight = false;
  }
}

function startScheduler(cronExpression) {
  if (activeJob) { activeJob.stop(); activeJob = null; }

  jobStatus.running  = true;
  jobStatus.schedule = cronExpression;

  activeJob = cron.schedule(cronExpression, async () => {
    try {
      await runPipeline();
    } catch (err) {
      console.error('[Scheduler] Pipeline error:', err.message);
      jobStatus.lastResult = { success: false, error: err.message, failedAt: new Date().toISOString() };
    }
  });

  console.log(`[Scheduler] Started — schedule: ${cronExpression}`);
  return jobStatus;
}

function stopScheduler() {
  if (activeJob) { activeJob.stop(); activeJob = null; }
  jobStatus.running = false;
  return jobStatus;
}

function getStatus() {
  return jobStatus;
}

function setLastResult(result) {
  jobStatus.lastResult = result;
}

function autoResume() {
  const defaultCron = process.env.DEFAULT_CRON || '0 */6 * * *'; // every 6 hours by default
  console.log(`[Scheduler] Auto-resuming with schedule: ${defaultCron}`);
  startScheduler(defaultCron);
}

module.exports = { runPipeline, startScheduler, stopScheduler, getStatus, setLastResult, autoResume, pickSource, slotPlan };

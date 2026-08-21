const cron = require('node-cron');
const { fetchNewsArticle, fetchTrendingArticle, markPosted } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');

let activeJob = null;

// Set REQUIRE_QUALITY=false to publish regardless of the score.
const REQUIRE_QUALITY = process.env.REQUIRE_QUALITY !== 'false';

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
    console.log('[Pipeline] Fetching top trending story from HN front page...');

    // Always use HN trending — most viral story right now
    const article = await fetchTrendingArticle();
    console.log(`[Pipeline] Trending: "${article.title}" (${article.points} pts)`);

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

    const postId = await postCarousel(imagePaths, caption);
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

module.exports = { runPipeline, startScheduler, stopScheduler, getStatus, setLastResult, autoResume };

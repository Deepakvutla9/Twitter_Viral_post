const cron = require('node-cron');
const { fetchNewsArticle, fetchTrendingArticle, markPosted } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');

let activeJob = null;

let jobStatus = {
  running: false,
  schedule: null,
  lastRun: null,
  lastResult: null,
  nextTopic: 'HN Trending',
  totalPosted: 0,
};

async function runPipeline() {
  jobStatus.lastRun = new Date().toISOString();

  console.log('[Pipeline] Fetching top trending story from HN front page...');

  // Always use HN trending — most viral story right now
  const article = await fetchTrendingArticle();
  console.log(`[Pipeline] Trending: "${article.title}" (${article.points} pts)`);

  const { slides, caption } = await generateCarouselSlides(article, article.title);
  console.log(`[Pipeline] Generated ${slides.length} slides`);

  const images = await composeSlideImages(slides, article.ogImage || null);
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
      jobStatus.lastResult = { success: false, error: err.message };
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

function autoResume() {
  const defaultCron = process.env.DEFAULT_CRON || '0 */6 * * *'; // every 6 hours by default
  console.log(`[Scheduler] Auto-resuming with schedule: ${defaultCron}`);
  startScheduler(defaultCron);
}

module.exports = { runPipeline, startScheduler, stopScheduler, getStatus, autoResume };

const cron = require('node-cron');
const { fetchNewsArticle, markPosted } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');

const AUTO_TOPICS = [
  'AI layoffs job cuts',
  'AI replacing human jobs',
  'AI robots automation replacing workers',
  'new AI model released',
  'new AI job titles careers',
  'AI education courses training',
  'OpenAI news',
  'Anthropic Claude news',
  'Google AI Gemini',
  'AI funding startup billion',
  'AI research breakthrough',
  'AI executive hired million salary',
  'AI researcher recruited package',
];

let activeJob = null;
let topicIndex = 0;

let jobStatus = {
  running: false,
  schedule: null,
  lastRun: null,
  lastResult: null,
  nextTopic: AUTO_TOPICS[0],
  totalPosted: 0,
};

async function runPipeline() {
  const topic = AUTO_TOPICS[topicIndex % AUTO_TOPICS.length];
  topicIndex++;

  jobStatus.nextTopic = AUTO_TOPICS[topicIndex % AUTO_TOPICS.length];
  jobStatus.lastRun   = new Date().toISOString();

  console.log(`[Pipeline] Running — topic: "${topic}"`);

  const article = await fetchNewsArticle(topic);
  console.log(`[Pipeline] Fetched: "${article.title}" (${article.points} pts)`);

  const { slides, caption } = await generateCarouselSlides(article, topic);
  console.log(`[Pipeline] Generated ${slides.length} slides`);

  const images = await composeSlideImages(slides, article.ogImage || null);
  const imagePaths = images.map((i) => i.filepath);

  const postId = await postCarousel(imagePaths, caption);
  await markPosted(article.url);
  jobStatus.totalPosted++;

  const result = {
    success: true,
    postId,
    topic,
    article: article.title,
    postedAt: new Date().toISOString(),
  };
  jobStatus.lastResult = result;

  console.log(`[Pipeline] Posted carousel: ${postId} (total: ${jobStatus.totalPosted})`);
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

function autoResume() {}

module.exports = { runPipeline, startScheduler, stopScheduler, getStatus, autoResume };

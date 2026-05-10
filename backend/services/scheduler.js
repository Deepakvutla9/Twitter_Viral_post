const { fetchNewsArticle } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');

const AUTO_TOPICS = [
  'OpenAI',
  'Anthropic',
  'AI layoffs',
  'Google AI',
  'AI model release',
  'AI funding',
  'AI regulation',
  'AI jobs',
  'artificial intelligence',
  'machine learning',
];

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

  const images = await composeSlideImages(slides);
  const imagePaths = images.map((i) => i.filepath);

  const postId = await postCarousel(imagePaths, caption);
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

// Called by the scheduler route when cron-job.org hits /api/scheduler/run
function startScheduler(cronExpression) {
  jobStatus.running  = true;
  jobStatus.schedule = cronExpression;
  console.log(`[Scheduler] Marked active — schedule managed by cron-job.org: ${cronExpression}`);
  return jobStatus;
}

function stopScheduler() {
  jobStatus.running = false;
  return jobStatus;
}

function getStatus() {
  return jobStatus;
}

// No-op on cloud — state is in-memory only, cron-job.org drives timing
function autoResume() {}

module.exports = { runPipeline, startScheduler, stopScheduler, getStatus, autoResume };

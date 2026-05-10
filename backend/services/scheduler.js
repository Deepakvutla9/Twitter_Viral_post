const cron = require('node-cron');
const { scrapeTrendingTweets } = require('./xScraper');
const { generateMultiplePosts } = require('./gemini');
const { postToInstagram } = require('./instagram');

let activeJob = null;
let jobStatus = {
  running: false,
  schedule: null,
  topic: null,
  lastRun: null,
  lastResult: null,
};

async function runPipeline(topic, count = 5) {
  console.log(`[Pipeline] Starting for topic: "${topic}"`);
  jobStatus.lastRun = new Date().toISOString();

  const tweets = await scrapeTrendingTweets(topic, count);
  console.log(`[Pipeline] Scraped ${tweets.length} tweets`);

  const posts = await generateMultiplePosts(tweets, topic);
  console.log(`[Pipeline] Generated ${posts.length} IG captions`);

  const results = [];
  for (const post of posts) {
    try {
      const postId = await postToInstagram(post.caption);
      results.push({ success: true, postId, caption: post.caption });
      console.log(`[Pipeline] Posted to IG: ${postId}`);
      // Respect Instagram rate limits — wait 30s between posts
      await new Promise((r) => setTimeout(r, 30000));
    } catch (err) {
      results.push({ success: false, error: err.message, caption: post.caption });
      console.error(`[Pipeline] IG post failed:`, err.message);
    }
  }

  jobStatus.lastResult = results;
  return results;
}

function startScheduler(cronExpression, topic, count = 5) {
  if (activeJob) {
    activeJob.stop();
  }

  jobStatus.running = true;
  jobStatus.schedule = cronExpression;
  jobStatus.topic = topic;

  activeJob = cron.schedule(cronExpression, async () => {
    try {
      await runPipeline(topic, count);
    } catch (err) {
      console.error('[Scheduler] Pipeline error:', err.message);
      jobStatus.lastResult = { error: err.message };
    }
  });

  console.log(`[Scheduler] Started — topic: "${topic}", schedule: ${cronExpression}`);
  return jobStatus;
}

function stopScheduler() {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
  }
  jobStatus.running = false;
  return jobStatus;
}

function getStatus() {
  return jobStatus;
}

module.exports = { runPipeline, startScheduler, stopScheduler, getStatus };

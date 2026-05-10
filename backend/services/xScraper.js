const axios = require('axios');

// Uses Reddit's free public API - no login required
// Searches for trending posts on a topic across all of Reddit
async function scrapeTrendingTweets(topic, count = 10) {
  console.log(`[Scraper] Fetching trending Reddit posts for: "${topic}"`);

  const headers = {
    'User-Agent': 'ViralPoster/1.0 (automated content tool)',
    'Accept': 'application/json',
  };

  // Search Reddit for hot posts about the topic
  const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=comments&limit=${count * 2}&type=link`;

  const res = await axios.get(searchUrl, { headers, timeout: 15000 });
  const posts = res.data?.data?.children || [];

  if (!posts.length) {
    throw new Error(`No posts found for topic "${topic}" on Reddit`);
  }

  // Map Reddit posts to the same format as tweets
  const results = posts
    .filter((p) => p.data.selftext !== '[removed]' && !p.data.over_18)
    .sort((a, b) => b.data.num_comments - a.data.num_comments)
    .slice(0, count)
    .map((p) => {
      const d = p.data;
      const text = d.selftext
        ? `${d.title}\n\n${d.selftext.slice(0, 280)}`
        : d.title;

      return {
        text: text.trim(),
        likes: d.score?.toString() || '0',
        retweets: d.num_comments?.toString() || '0',
        replies: '0',
        username: d.author || 'unknown',
        timestamp: new Date(d.created_utc * 1000).toISOString(),
        source: 'reddit',
        subreddit: d.subreddit,
        url: `https://reddit.com${d.permalink}`,
      };
    });

  console.log(`[Scraper] Got ${results.length} posts from Reddit`);
  return results;
}

module.exports = { scrapeTrendingTweets };

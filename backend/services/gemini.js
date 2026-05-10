const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateInstagramPost(tweet, topic) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are a viral Instagram content creator. Convert this trending tweet into an engaging Instagram post.

Topic: ${topic}
Tweet: "${tweet.text}"
Likes: ${tweet.likes} | Retweets: ${tweet.retweets}

Rules:
- Write a punchy, engaging caption (2-4 sentences max)
- Add a strong hook on the first line
- Include 10-15 relevant trending hashtags at the end
- Use emojis naturally throughout
- Make it feel authentic, not robotic
- Format: Caption text first, then a blank line, then hashtags

Return ONLY the Instagram post text, nothing else.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function generateMultiplePosts(tweets, topic) {
  const posts = [];
  for (const tweet of tweets) {
    try {
      const caption = await generateInstagramPost(tweet, topic);
      posts.push({ tweet, caption });
      // Avoid hitting per-minute rate limits
      await new Promise((r) => setTimeout(r, 4000));
    } catch (err) {
      console.error('Gemini error for tweet:', err.message);
    }
  }
  return posts;
}

module.exports = { generateInstagramPost, generateMultiplePosts };

const express = require('express');
const router = express.Router();
const { generateMultiplePosts, generateInstagramPost } = require('../services/gemini');

// Generate IG captions for an array of tweets
router.post('/', async (req, res) => {
  const { tweets, topic } = req.body;
  if (!tweets || !topic) return res.status(400).json({ error: 'tweets and topic are required' });

  try {
    const posts = await generateMultiplePosts(tweets, topic);
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate a single caption
router.post('/single', async (req, res) => {
  const { tweet, topic } = req.body;
  if (!tweet || !topic) return res.status(400).json({ error: 'tweet and topic are required' });

  try {
    const caption = await generateInstagramPost(tweet, topic);
    res.json({ caption });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

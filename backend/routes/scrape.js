const express = require('express');
const router = express.Router();
const { scrapeTrendingTweets } = require('../services/xScraper');

router.post('/', async (req, res) => {
  const { topic, count = 10 } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });

  try {
    const tweets = await scrapeTrendingTweets(topic, count);
    res.json({ tweets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

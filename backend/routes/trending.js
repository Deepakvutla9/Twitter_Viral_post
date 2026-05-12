const express = require('express');
const router = express.Router();
const axios = require('axios');

// Return top 20 HN front page stories for display
router.get('/', async (req, res) => {
  try {
    const idsRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 8000 });
    const ids = idsRes.data.slice(0, 30);

    const stories = await Promise.all(
      ids.map((id) =>
        axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5000 })
          .then((r) => r.data)
          .catch(() => null)
      )
    );

    const filtered = stories
      .filter((s) => s && s.url && s.title && s.type === 'story')
      .map((s) => ({
        title:   s.title,
        url:     s.url,
        points:  s.score,
        source:  new URL(s.url).hostname.replace('www.', ''),
        pubDate: new Date(s.time * 1000).toISOString(),
      }));

    res.json({ stories: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

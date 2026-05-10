const express = require('express');
const router = express.Router();
const { fetchNewsArticle } = require('../services/newsScraper');

router.post('/', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });

  try {
    const article = await fetchNewsArticle(topic);
    res.json({ article });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

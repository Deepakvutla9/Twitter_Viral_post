const express = require('express');
const router = express.Router();
const { fetchNewsArticle } = require('../services/newsScraper');
const { withAccount } = require('../middleware/auth');

router.post('/', withAccount(async (req, res, account) => {
  const { topic, exclude } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });

  try {
    const article = await fetchNewsArticle(topic, exclude || [], account);
    res.json({ article });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

module.exports = router;

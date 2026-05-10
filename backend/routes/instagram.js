const express = require('express');
const router = express.Router();
const { postToInstagram } = require('../services/instagram');

router.post('/post', async (req, res) => {
  const { caption, imageUrl } = req.body;
  if (!caption) return res.status(400).json({ error: 'caption is required' });

  try {
    const postId = await postToInstagram(caption, imageUrl);
    res.json({ success: true, postId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { postCarousel } = require('../services/instagram');
const { markPosted } = require('../services/newsScraper');

router.post('/carousel', async (req, res) => {
  const { imagePaths, caption, articleUrl } = req.body;
  if (!imagePaths || !imagePaths.length) return res.status(400).json({ error: 'imagePaths are required' });
  if (!caption) return res.status(400).json({ error: 'caption is required' });

  try {
    const postId = await postCarousel(imagePaths, caption);
    // Save URL to Supabase so it won't be posted again
    console.log(`[Route] articleUrl received: ${articleUrl || 'NONE'}`);
    if (articleUrl) {
      await markPosted(articleUrl);
    } else {
      console.log('[Route] No articleUrl passed — skipping markPosted');
    }
    res.json({ success: true, postId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

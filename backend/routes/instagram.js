const express = require('express');
const router = express.Router();
const { postCarousel, checkToken } = require('../services/instagram');
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

// Read-only token health check — posts nothing. Exists so an expired token can
// be diagnosed from outside the instance instead of by squinting at deploy logs.
router.get('/token', async (req, res) => {
  const result = await checkToken();
  res.status(result.ok ? 200 : 502).json(result);
});

module.exports = router;

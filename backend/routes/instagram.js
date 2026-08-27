const express = require('express');
const router = express.Router();
const { postCarousel, checkToken } = require('../services/instagram');
const { markPosted } = require('../services/newsScraper');
const { withAccount } = require('../middleware/auth');

// The account now arrives with the request, which is only safe because the
// router is mounted behind requireApiKey and withAccount checks the slug is
// active and allowlisted. Absent means the default account.
router.post('/carousel', withAccount(async (req, res, acct) => {
  const { imagePaths, caption, articleUrl } = req.body;
  if (!imagePaths || !imagePaths.length) return res.status(400).json({ error: 'imagePaths are required' });
  if (!caption) return res.status(400).json({ error: 'caption is required' });

  try {
    const postId = await postCarousel(imagePaths, caption, acct);
    // Save URL to Supabase so it won't be posted again
    console.log(`[Route] articleUrl received: ${articleUrl || 'NONE'}`);
    if (articleUrl) {
      await markPosted(articleUrl, acct);
    } else {
      console.log('[Route] No articleUrl passed — skipping markPosted');
    }
    res.json({ success: true, postId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// Read-only token health check — posts nothing. Exists so an expired token can
// be diagnosed from outside the instance instead of by squinting at deploy logs.
router.get('/token', withAccount(async (req, res, acct) => {
  try {
    const result = await checkToken(acct);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    // A misconfigured account is a diagnosis too — this endpoint exists to say
    // why posting is broken, so it should answer rather than throw.
    res.status(502).json({ ok: false, error: err.message });
  }
}));

module.exports = router;

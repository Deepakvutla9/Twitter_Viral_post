const express = require('express');
const router = express.Router();
const { postCarousel, checkToken } = require('../services/instagram');
const { markPosted } = require('../services/newsScraper');
const { getAccount } = require('../services/accounts');

// These routes deliberately do NOT take an account from the request body yet.
// The endpoint is unauthenticated, and letting an unauthenticated caller choose
// which account to publish as is exactly the hole that has to close first. The
// account parameter arrives together with authentication and a slug allowlist.
const account = () => getAccount();

router.post('/carousel', async (req, res) => {
  const { imagePaths, caption, articleUrl } = req.body;
  if (!imagePaths || !imagePaths.length) return res.status(400).json({ error: 'imagePaths are required' });
  if (!caption) return res.status(400).json({ error: 'caption is required' });

  try {
    const postId = await postCarousel(imagePaths, caption, await account());
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
  try {
    const result = await checkToken(await account());
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    // A misconfigured account is a diagnosis too — this endpoint exists to say
    // why posting is broken, so it should answer rather than throw.
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;

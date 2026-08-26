const express = require('express');
const router = express.Router();
const { generateCarouselSlides } = require('../services/gemini');
const { composeSlideImages } = require('../services/imageComposer');
const { getAccount } = require('../services/accounts');

router.post('/', async (req, res) => {
  const { article, topic } = req.body;
  if (!article || !topic) return res.status(400).json({ error: 'article and topic are required' });

  try {
    const account = await getAccount();
    const { slides, caption, imagePrompt, quality } = await generateCarouselSlides(article, topic, account);
    const images = await composeSlideImages(slides, {
      ogImage: article.ogImage || null,
      imagePrompt: imagePrompt || null,
      account,
    });
    const imageUrls = images.map((img) => `/temp/${img.filename}`);
    res.json({ slides, caption, imageUrls, imagePaths: images.map((i) => i.filepath), quality });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

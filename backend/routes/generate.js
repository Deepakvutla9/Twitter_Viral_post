const express = require('express');
const router = express.Router();
const { generateCarouselSlides } = require('../services/gemini');
const { composeSlideImages } = require('../services/imageComposer');

router.post('/', async (req, res) => {
  const { article, topic } = req.body;
  if (!article || !topic) return res.status(400).json({ error: 'article and topic are required' });

  try {
    const { slides, caption, imagePrompt } = await generateCarouselSlides(article, topic);
    const images = await composeSlideImages(slides, article.ogImage || null, imagePrompt || null);
    const imageUrls = images.map((img) => `/temp/${img.filename}`);
    res.json({ slides, caption, imageUrls, imagePaths: images.map((i) => i.filepath) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

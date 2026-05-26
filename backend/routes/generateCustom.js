const express  = require('express');
const multer   = require('multer');
const sharp    = require('sharp');
const router   = express.Router();
const { generateCarouselSlides } = require('../services/gemini');
const { composeSlideImages }     = require('../services/imageComposer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/', upload.single('image'), async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  try {
    // Build a fake article object so gemini.js can work with it as normal
    const article = {
      title,
      source: 'Custom',
      fullText: `${title}\n\n${body}`,
      ogImage: null,
      url: '',
    };

    const { slides, caption, imagePrompt } = await generateCarouselSlides(article, title);

    // If an image was uploaded, process it to base64 for slide 1
    let customImageBase64 = null;
    if (req.file) {
      const buf = await sharp(req.file.buffer)
        .resize(1080, 1080, { fit: 'cover', position: 'top' })
        .jpeg({ quality: 90 })
        .toBuffer();
      customImageBase64 = buf.toString('base64');
    }

    const images    = await composeSlideImages(slides, null, imagePrompt, customImageBase64);
    const imageUrls = images.map((img) => `/temp/${img.filename}`);

    res.json({ slides, caption, imageUrls, imagePaths: images.map((i) => i.filepath) });
  } catch (err) {
    console.error('[CustomGenerate]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

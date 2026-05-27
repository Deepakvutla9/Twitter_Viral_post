const express = require('express');
const router  = express.Router();
const queue   = require('../services/postQueue');

// GET /api/queue — list all
router.get('/', (req, res) => {
  res.json(queue.getAll());
});

// POST /api/queue — add scheduled post
router.post('/', (req, res) => {
  const { title, imagePaths, caption, scheduledAt } = req.body;
  if (!imagePaths || !caption || !scheduledAt) {
    return res.status(400).json({ error: 'imagePaths, caption, scheduledAt are required' });
  }
  const item = queue.add({ title: title || '', imagePaths, caption, scheduledAt });
  res.json(item);
});

// DELETE /api/queue/:id — cancel
router.delete('/:id', (req, res) => {
  queue.remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

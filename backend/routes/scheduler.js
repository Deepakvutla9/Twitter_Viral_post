const express = require('express');
const router = express.Router();
const { runPipeline, startScheduler, stopScheduler, getStatus } = require('../services/scheduler');

router.get('/status', (req, res) => {
  res.json(getStatus());
});

router.post('/start', (req, res) => {
  const { cronExpression, topic, count } = req.body;
  if (!cronExpression || !topic) {
    return res.status(400).json({ error: 'cronExpression and topic are required' });
  }
  const status = startScheduler(cronExpression, topic, count);
  res.json({ success: true, status });
});

router.post('/stop', (req, res) => {
  const status = stopScheduler();
  res.json({ success: true, status });
});

// Trigger the full pipeline manually (scrape → generate → post)
router.post('/run', async (req, res) => {
  const { topic, count = 5 } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  try {
    const results = await runPipeline(topic, count);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { runPipeline, startScheduler, stopScheduler, getStatus } = require('../services/scheduler');

router.get('/status', (req, res) => {
  res.json(getStatus());
});

router.post('/start', (req, res) => {
  const { cronExpression } = req.body;
  if (!cronExpression) return res.status(400).json({ error: 'cronExpression is required' });
  const status = startScheduler(cronExpression);
  res.json({ success: true, status });
});

router.post('/stop', (req, res) => {
  const status = stopScheduler();
  res.json({ success: true, status });
});

router.post('/run', async (req, res) => {
  try {
    const result = await runPipeline();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

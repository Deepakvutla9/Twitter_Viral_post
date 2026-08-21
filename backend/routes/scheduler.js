const express = require('express');
const router = express.Router();
const { runPipeline, startScheduler, stopScheduler, getStatus, setLastResult } = require('../services/scheduler');

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
    const result = await runPipeline({ force: true });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// External trigger for the GitHub Actions scheduler.
//
// On Render's free tier the instance sleeps after ~15 minutes idle, and a
// sleeping instance runs no in-process cron — which is why posting stopped.
// GitHub Actions calls this on a schedule; the request itself wakes the
// instance, and the pipeline then runs here.
//
// Fire-and-forget on purpose: a full run (scrape → Groq → image gen → IG
// upload) can outlast the proxy's request timeout. We ack immediately and the
// caller confirms the outcome by polling /status.
router.post('/trigger', (req, res) => {
  const expected = process.env.TRIGGER_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'TRIGGER_SECRET is not configured on this server' });
  }
  const provided = req.get('x-trigger-secret') || '';
  if (provided !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  res.status(202).json({ accepted: true, startedAt: new Date().toISOString() });

  runPipeline()
    .then((result) => {
      // A skipped run is not a failure — it means something already posted in
      // this slot. Record it so the caller can tell it apart from a timeout.
      if (result && result.skipped) {
        setLastResult({ ...getStatus().lastResult, skipped: true, reason: result.reason, skippedAt: new Date().toISOString() });
      }
    })
    .catch((err) => {
      console.error('[Trigger] Pipeline error:', err.message);
      setLastResult({ success: false, error: err.message, failedAt: new Date().toISOString() });
    });
});

module.exports = router;

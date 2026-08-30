const express = require('express');
const router = express.Router();
const { listActiveAccounts, listAllAccounts, setAccountActive } = require('../services/accounts');

// Config only — no tokens, no ig_user_id: this is behind the API key, but there
// is no reason for a browser to hold an account's identifiers just to draw a
// dropdown.
const publicShape = (a) => ({
  slug: a.slug,
  displayName: a.displayName,
  handle: a.handle,
  accent: a.accent,
  cron: a.cron,
  timezone: a.timezone,
  active: a.active,
  // A row that only exists in environment variables cannot be toggled, and the
  // UI needs to know that before it offers a switch that would 503.
  managed: a.source !== 'env-fallback',
});

/**
 * ?all=1 includes inactive accounts, for the management panel. The default stays
 * active-only because that is what the publishing selector must show: an account
 * that is switched off is not a legal publishing target, and offering it there
 * would produce a 404 at post time instead of at selection time.
 */
router.get('/', async (req, res) => {
  try {
    const all = req.query.all === '1' || req.query.all === 'true';
    const accounts = all ? await listAllAccounts() : await listActiveAccounts();
    res.json({ accounts: accounts.map(publicShape) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Switch one account's publishing on or off.
 *
 * Deliberately the only writable field. Everything else about an account —
 * credentials, slot plan, branding — changes the meaning of what gets published,
 * and belongs in a migration or the database, not in a browser request.
 */
router.patch('/:slug', async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'body must be { "active": true } or { "active": false }' });
  }
  try {
    const updated = await setAccountActive(req.params.slug, active);
    res.json({ account: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;

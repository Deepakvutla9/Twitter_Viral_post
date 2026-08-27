const express = require('express');
const router = express.Router();
const { listActiveAccounts } = require('../services/accounts');

// What the UI needs to offer an account selector. Config only — no tokens, no
// ig_user_id: this is behind the API key, but there is no reason for a browser
// to hold an account's identifiers just to draw a dropdown.
router.get('/', async (req, res) => {
  try {
    const accounts = await listActiveAccounts();
    res.json({
      accounts: accounts.map((a) => ({
        slug: a.slug,
        displayName: a.displayName,
        handle: a.handle,
        accent: a.accent,
        cron: a.cron,
        timezone: a.timezone,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

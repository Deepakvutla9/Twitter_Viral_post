const { getAccount, listActiveAccounts } = require('../services/accounts');

/**
 * Authentication for the human-facing API.
 *
 * The trigger endpoint has its own secret because it is machine-to-machine and
 * fires the whole slot. Everything a person can reach needs separate credentials:
 * with one account these routes only cost money, but with several they choose
 * which handle to publish as, and an unauthenticated caller must never make that
 * choice.
 *
 * Reads that publish nothing stay open, because the scheduled workflow polls
 * /api/scheduler/status without credentials and locking it would mean putting
 * the API key into a second place.
 */

function timingSafeEqual(a, b) {
  // Not constant time in the strict sense — Node's crypto version needs equal
  // lengths, and revealing the length of a key that is compared this rarely is
  // not the weak point. Compare every byte anyway rather than bailing early.
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function presentedKey(req) {
  const header = req.get('x-api-key');
  if (header) return header;
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;

  if (!expected) {
    // Refusing is the only safe default: these routes publish to Instagram and
    // spend Groq credit. An unset key must not mean "open to everyone".
    return res.status(503).json({
      error: 'API_KEY is not configured on this server, so authenticated routes are closed.',
    });
  }

  const given = presentedKey(req);
  if (!given || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

/**
 * Which account this request acts as.
 *
 * Absent means the default account, which keeps every existing single-account
 * caller working. A named account has to clear three checks: it exists, it is
 * active, and it is on the allowlist if one is configured. API_ACCOUNT_ALLOWLIST
 * is a comma-separated list of slugs; unset means every active account.
 */
function allowlist() {
  const raw = process.env.API_ACCOUNT_ALLOWLIST;
  if (!raw || !raw.trim()) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

async function resolveRequestAccount(req) {
  const requested = (req.body && req.body.account)
    || (req.query && req.query.account)
    || null;

  if (!requested) return getAccount();

  const slug = String(requested).trim();
  const allowed = allowlist();
  if (allowed && !allowed.has(slug)) {
    const err = new Error(`account "${slug}" is not permitted for this API key`);
    err.status = 403;
    throw err;
  }

  const active = await listActiveAccounts();
  const match = active.find((a) => a.slug === slug);
  if (!match) {
    // Deliberately the same answer for "no such account" and "inactive": an
    // unauthenticated-adjacent caller learning which slugs exist is not useful
    // to them, and an inactive account is not publishable either way.
    const err = new Error(`account "${slug}" is not available`);
    err.status = 404;
    throw err;
  }
  return match;
}

// Wraps a handler so an account problem answers with its own status rather than
// surfacing as a generic 500.
function withAccount(handler) {
  return async (req, res) => {
    let account;
    try {
      account = await resolveRequestAccount(req);
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
    return handler(req, res, account);
  };
}

module.exports = { requireApiKey, resolveRequestAccount, withAccount };

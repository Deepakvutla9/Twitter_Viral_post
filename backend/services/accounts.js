const cron = require('node-cron');
const { getSupabase } = require('./supabase');

// The single configuration boundary for "which account are we posting as".
//
// Everything downstream — credentials, dedupe, branding, scheduling — takes a
// normalized account object from here and never reads process.env for
// per-account values. That is the whole point: one place decides what an
// account is, and it either returns a complete valid account or throws.

const CONTENT_SOURCES = ['tech', 'visa', 'trump'];
const DEFAULT_SLUG = process.env.DEFAULT_ACCOUNT_SLUG || 'shadesofirony';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,38}$/;
const HANDLE_RE = /^@[A-Za-z0-9._]{1,30}$/;
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;
const IG_ID_RE = /^\d{5,25}$/;

const CACHE_TTL_MS = Number(process.env.ACCOUNT_CACHE_TTL_MS || 60_000);
let cache = { at: 0, bySlug: new Map(), invalid: new Map() };

class AccountConfigError extends Error {
  constructor(slug, problems) {
    super(`Account "${slug}" is not usable: ${problems.join('; ')}`);
    this.name = 'AccountConfigError';
    this.slug = slug;
    this.problems = problems;
  }
}

function normalizeSlotPlan(raw, problems) {
  if (raw == null) return [...CONTENT_SOURCES];
  const list = Array.isArray(raw)
    ? raw
    : String(raw).split(',');
  const cleaned = list.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const unknown = cleaned.filter((s) => !CONTENT_SOURCES.includes(s));
  if (unknown.length) problems.push(`slot_plan has unknown source(s): ${unknown.join(', ')}`);
  const valid = cleaned.filter((s) => CONTENT_SOURCES.includes(s));
  if (!valid.length) problems.push('slot_plan is empty');
  return valid;
}

function normalizeVoice(raw, problems) {
  if (raw == null || raw === '') return { tone: null, audience: null, avoid: [] };
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { problems.push('voice is not valid JSON'); return { tone: null, audience: null, avoid: [] }; }
  }
  if (typeof v !== 'object' || Array.isArray(v)) {
    problems.push('voice must be an object');
    return { tone: null, audience: null, avoid: [] };
  }
  // Style only. Grounding and number/date verification are immutable prompt
  // sections; an account that tries to set them is a configuration error, not
  // a supported override.
  const forbidden = ['grounding', 'facts', 'rules', 'system', 'prompt'];
  const offending = Object.keys(v).filter((k) => forbidden.includes(k.toLowerCase()));
  if (offending.length) problems.push(`voice may not set ${offending.join(', ')} — style fields only`);
  return {
    tone: v.tone ? String(v.tone).slice(0, 300) : null,
    audience: v.audience ? String(v.audience).slice(0, 300) : null,
    avoid: Array.isArray(v.avoid) ? v.avoid.map((s) => String(s).slice(0, 80)).slice(0, 20) : [],
  };
}

/**
 * Turn a raw row (database or env-built) into a normalized account, or throw.
 * Exported so tests and an admin endpoint can validate without a database.
 */
function normalizeAccount(row, { source = 'database' } = {}) {
  const problems = [];
  const slug = String(row?.slug || '').trim();
  if (!SLUG_RE.test(slug)) problems.push(`slug "${slug}" is not a valid slug`);

  const handle = String(row?.handle || '').trim();
  if (!HANDLE_RE.test(handle)) problems.push(`handle "${handle}" must look like @name`);

  const igUserId = String(row?.ig_user_id ?? '').trim();
  if (!IG_ID_RE.test(igUserId)) problems.push('ig_user_id is missing or not numeric');

  const accent = String(row?.accent || '#00e5ff').trim();
  // Rendered straight into SVG downstream, so it is constrained here as well as
  // by a database check constraint. The renderer still escapes; this is belt.
  if (!ACCENT_RE.test(accent)) problems.push(`accent "${accent}" must be #rrggbb`);

  const cronExpr = String(row?.cron || '0 */6 * * *').trim();
  if (!cron.validate(cronExpr)) problems.push(`cron "${cronExpr}" is not a valid expression`);

  const slotPlan = normalizeSlotPlan(row?.slot_plan, problems);
  const voice = normalizeVoice(row?.voice, problems);
  const timezone = String(row?.timezone || 'UTC').trim() || 'UTC';

  if (problems.length) throw new AccountConfigError(slug || '(no slug)', problems);

  return Object.freeze({
    slug,
    displayName: String(row?.display_name || slug),
    handle,
    igUserId,
    accent,
    cron: cronExpr,
    timezone,
    slotPlan: Object.freeze(slotPlan),
    hashtagExtra: Object.freeze(
      Array.isArray(row?.hashtag_extra) ? row.hashtag_extra.map(String) : [],
    ),
    groqModel: row?.groq_model ? String(row.groq_model) : null,
    voice: Object.freeze(voice),
    active: row?.active !== false,
    source,
  });
}

/**
 * TEMPORARY. Builds the one legacy account from environment variables, and only
 * when the database has no row for it at all.
 *
 * Deliberately all-or-nothing: a half-filled database row is never topped up
 * from global env, because that silently mixes one account's identity with
 * another account's settings. Delete this once the row is confirmed live.
 */
function accountFromEnv(slug) {
  if (slug !== 'shadesofirony') return null;
  if (!process.env.INSTAGRAM_USER_ID) return null;
  console.warn(
    `[Accounts] ⚠ Falling back to env config for "${slug}" — no database row found. ` +
    'This path is temporary; add the row and remove the fallback.',
  );
  return normalizeAccount({
    slug,
    display_name: 'Synthetic Minds',
    handle: '@shadesofirony',
    ig_user_id: process.env.INSTAGRAM_USER_ID,
    accent: '#00e5ff',
    cron: process.env.DEFAULT_CRON || '0 */6 * * *',
    slot_plan: process.env.SLOT_PLAN || ['tech', 'visa', 'trump', 'visa'],
    active: true,
  }, { source: 'env-fallback' });
}

async function loadAll({ force = false } = {}) {
  const fresh = cache.at && Date.now() - cache.at < CACHE_TTL_MS;
  if (!force && fresh) return cache;

  const db = getSupabase();
  const bySlug = new Map();
  // Rows that exist but failed validation. Tracked separately from absent rows:
  // a broken row must never fall through to the env fallback, or one account's
  // settings quietly start posting with another account's credentials.
  const invalid = new Map();

  if (db) {
    const { data, error } = await db.from('accounts').select('*');
    if (error) throw new Error(`[Accounts] could not read accounts: ${error.message}`);
    for (const row of data || []) {
      try {
        const acct = normalizeAccount(row);
        bySlug.set(acct.slug, acct);
      } catch (e) {
        // One broken row must not take the others down with it.
        const slug = String(row?.slug || '(no slug)');
        invalid.set(slug, e);
        console.error(`[Accounts] skipping unusable row "${slug}": ${e.message}`);
      }
    }
  } else {
    console.warn('[Accounts] Supabase not configured — env fallback only.');
  }

  cache = { at: Date.now(), bySlug, invalid };
  return cache;
}

async function getAccount(slug = DEFAULT_SLUG, opts = {}) {
  const { bySlug, invalid } = await loadAll(opts);
  const found = bySlug.get(slug);
  if (found) return found;

  // Present but unusable — surface the real problem rather than substituting
  // a different configuration for it.
  if (invalid.has(slug)) throw invalid.get(slug);

  const fallback = accountFromEnv(slug);
  if (fallback) return fallback;

  const known = [...bySlug.keys()];
  throw new AccountConfigError(slug, [
    known.length ? `no such account (known: ${known.join(', ')})` : 'no accounts are configured',
  ]);
}

async function listActiveAccounts(opts = {}) {
  const { bySlug, invalid } = await loadAll(opts);
  const active = [...bySlug.values()].filter((a) => a.active);
  if (active.length) return active;

  // Same rule as getAccount: a broken legacy row is a failure to fix, not a
  // reason to fall back to env.
  if (invalid.size) {
    throw new AccountConfigError(DEFAULT_SLUG, [
      `no usable accounts; ${invalid.size} row(s) failed validation`,
    ]);
  }

  const fallback = accountFromEnv(DEFAULT_SLUG);
  return fallback ? [fallback] : [];
}

function invalidateCache() {
  cache = { at: 0, bySlug: new Map(), invalid: new Map() };
}

module.exports = {
  getAccount,
  listActiveAccounts,
  normalizeAccount,
  invalidateCache,
  AccountConfigError,
  CONTENT_SOURCES,
  DEFAULT_SLUG,
};

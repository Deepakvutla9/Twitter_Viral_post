const { getSupabase } = require('./supabase');

// Instagram tokens, one per account, in ig_tokens.
//
// Two things make this more than a key-value read. First, a refreshed token
// replaces the only credential the account has, so a lost write must not leave
// us holding a token the database has already superseded. Second, the external
// trigger and the in-process cron can overlap, so two refreshes of the same
// account can run at once.
//
// refreshed_at doubles as the version. Every write moves it, so a compare-and-set
// on the value we read is enough: the second writer's UPDATE re-evaluates its
// WHERE after the first commits, matches nothing, and reports the loss.

// The one account that predates the ig_tokens table. Its token may still be
// sitting in INSTAGRAM_ACCESS_TOKEN. Temporary, same as the accounts.js fallback.
const LEGACY_SLUG = 'shadesofirony';

class TokenError extends Error {
  constructor(slug, message) {
    super(`Instagram token for "${slug}": ${message}`);
    this.name = 'TokenError';
    this.slug = slug;
  }
}

async function readRow(slug) {
  const db = getSupabase();
  if (!db) return null;
  const { data, error } = await db
    .from('ig_tokens')
    .select('token, expires_at, refreshed_at')
    .eq('account_slug', slug)
    .maybeSingle();
  if (error) throw new TokenError(slug, `could not be read: ${error.message}`);
  return data || null;
}

/**
 * The token to use right now, and the version to hand back to storeToken.
 * version === null means there is no row yet.
 */
async function resolveToken(account) {
  if (!account?.slug) throw new TokenError('(none)', 'called without an account');

  const row = await readRow(account.slug);
  if (row?.token) {
    return { token: row.token, version: row.refreshed_at, source: 'ig_tokens' };
  }

  // Same all-or-nothing rule as the accounts fallback: only the legacy account,
  // and only when the database has nothing for it.
  if (account.slug === LEGACY_SLUG && process.env.INSTAGRAM_ACCESS_TOKEN) {
    return { token: process.env.INSTAGRAM_ACCESS_TOKEN, version: null, source: 'env-fallback' };
  }

  throw new TokenError(
    account.slug,
    'not found in ig_tokens and no legacy environment token applies',
  );
}

/**
 * Compare-and-set the token.
 *
 * Returns { won: true } when this writer's value was stored, and
 * { won: false, token, version } when another refresh got there first — in which
 * case the winner's value is read back and returned, because that is the token
 * that is actually live. A loser must never keep using its own result.
 */
async function storeToken(account, token, { expiresAt = null, expectedVersion } = {}) {
  const db = getSupabase();
  const slug = account.slug;
  if (!db) return { won: false, token, version: null, persisted: false };

  const now = new Date().toISOString();

  if (expectedVersion == null) {
    // No row yet. Insert, and treat a duplicate key as a lost race.
    const { error } = await db
      .from('ig_tokens')
      .insert({ account_slug: slug, token, expires_at: expiresAt, refreshed_at: now });
    if (!error) return { won: true, token, version: now, persisted: true };
    if (error.code !== '23505') throw new TokenError(slug, `could not be stored: ${error.message}`);
    const winner = await readRow(slug);
    return { won: false, token: winner?.token ?? token, version: winner?.refreshed_at ?? null, persisted: true };
  }

  const { data, error } = await db
    .from('ig_tokens')
    .update({ token, expires_at: expiresAt, refreshed_at: now })
    .eq('account_slug', slug)
    .eq('refreshed_at', expectedVersion)
    .select('refreshed_at');
  if (error) throw new TokenError(slug, `could not be stored: ${error.message}`);

  if (data && data.length) return { won: true, token, version: now, persisted: true };

  // Matched no row: someone refreshed between our read and our write. Their
  // token is the live one.
  const winner = await readRow(slug);
  return { won: false, token: winner?.token ?? token, version: winner?.refreshed_at ?? null, persisted: true };
}

module.exports = { resolveToken, storeToken, readRow, TokenError, LEGACY_SLUG };

const { createClient } = require('@supabase/supabase-js');

// One Supabase client for the whole backend.
//
// Prefers the service-role key. That key bypasses RLS, which is what lets us
// lock every table down with no anon policies at all — the anon key then can do
// nothing, even if it leaks out of the frontend bundle. The anon fallback exists
// only so this code can deploy before the key is added to Render; once RLS is
// on, an anon-key process can read nothing and will say so loudly.
//
// This module must never be imported by anything that ships to the browser.

let client = null;
let usingServiceRole = false;
let warned = false;

/**
 * Fail closed in production rather than quietly running on the anon key.
 *
 * Once RLS is on, an anon-key process reads nothing from accounts or ig_tokens.
 * Discovering that as "no accounts configured" in the middle of a scheduled run
 * is far worse than refusing to start, so the refusal is explicit and happens
 * before anything tries to post.
 *
 * Deliberately keyed on NODE_ENV=production. If that is not set on the host,
 * this does not fire — so the startup log says which mode it decided on rather
 * than leaving it to be assumed.
 */
function assertProductionSafe() {
  if (process.env.NODE_ENV !== 'production') return;

  // Both, not either. A service-role key with no URL still yields a null client,
  // and the callers then fall back to legacy environment credentials — which is
  // the failure this guard exists to prevent, arriving by a different door.
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!missing.length) return;

  throw new Error(
    `Refusing to start: NODE_ENV=production with ${missing.join(' and ')} unset. ` +
    'Without a service-role connection the process cannot read accounts or ' +
    'ig_tokens once RLS is enabled, and would silently fall back to legacy ' +
    'environment credentials instead.',
  );
}

function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  assertProductionSafe();

  if (!url || (!serviceKey && !anonKey)) return null;

  const key = serviceKey || anonKey;
  usingServiceRole = Boolean(serviceKey);

  if (!usingServiceRole && !warned) {
    warned = true;
    console.warn(
      '[Supabase] Running on the ANON key. Reads of accounts/ig_tokens will return ' +
      'nothing once RLS is enabled. Set SUPABASE_SERVICE_ROLE_KEY on the server.',
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function isServiceRole() {
  getSupabase();
  return usingServiceRole;
}

// Tests only — lets a suite swap in a stub without a live database.
function __setClient(stub, serviceRole = true) {
  client = stub;
  usingServiceRole = serviceRole;
}

function __reset() {
  client = null;
  usingServiceRole = false;
  warned = false;
}

module.exports = { getSupabase, isServiceRole, assertProductionSafe, __setClient, __reset };

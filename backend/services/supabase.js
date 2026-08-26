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

function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
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

module.exports = { getSupabase, isServiceRole, __setClient, __reset };

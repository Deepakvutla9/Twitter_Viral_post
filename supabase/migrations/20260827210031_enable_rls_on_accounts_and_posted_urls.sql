-- The backend connects with the service-role key, which bypasses RLS entirely.
-- Enabling RLS with no policies therefore changes nothing for the application
-- and removes everything from everyone else: the anon key can no longer read or
-- write these tables even if it leaks.
--
-- posted_urls is the dedupe memory. An anon key could read every URL ever posted
-- or delete the lot, and a wiped history means the bot republishes old stories.
--
-- accounts holds no secrets, but it decides which handles exist, which are
-- active and what schedule they run on. Writable by anyone with the anon key is
-- not a reasonable position for a table that controls what gets published.
--
-- ig_tokens already had RLS enabled from the day it was created.
--
-- The database linter reports "RLS enabled, no policy" for these tables at INFO
-- level. That is the intended state, not an oversight: no policy is exactly what
-- "only the service role may touch this" means. Adding a permissive policy to
-- silence the notice would undo the change.

alter table public.posted_urls enable row level security;
alter table public.accounts enable row level security;

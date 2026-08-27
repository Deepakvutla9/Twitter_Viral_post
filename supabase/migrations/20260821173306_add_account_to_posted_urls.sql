-- Recorded in the remote migration history as 20260821173306, applied by an
-- earlier session through the Supabase MCP with no file in the repository.
-- Reconstructed here from the live schema so local history matches remote and a
-- fresh database rebuilds to the same shape. Do not re-run it against
-- production; it is already applied there.
--
-- This is where posted_urls.account came from. Every row predating multi-account
-- belongs to the one account that existed, hence the default. 20260826180223
-- later turns the column into a foreign key.

alter table public.posted_urls
  add column if not exists account text not null default 'shadesofirony';

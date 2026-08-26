-- Baseline. posted_urls predates the migration history entirely: it was created
-- by hand in the Supabase dashboard when dedupe memory moved off the local
-- posted-history.json file, and nothing recorded its shape.
--
-- This version is deliberately older than the first recorded migration
-- (20260821173306) because that one ALTERs this table. It has no counterpart in
-- the remote history and must be marked applied rather than run - see
-- supabase/MIGRATIONS.md.
--
-- The account column is NOT here on purpose: it arrives in 20260821173306.

create table if not exists public.posted_urls (
  id        bigserial primary key,
  url       text not null,
  posted_at timestamptz default now()
);

comment on table public.posted_urls is
  'Dedupe memory, capped at 100 rows per account. A story one account posted stays available to the others.';

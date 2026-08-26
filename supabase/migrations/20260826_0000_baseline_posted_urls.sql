-- Baseline. posted_urls predates this migration directory: it was created by
-- hand in the Supabase dashboard back when dedupe memory moved off the local
-- posted-history.json file. Nothing recorded its shape, so the later migrations
-- had nothing to build on and could not recreate a database from scratch.
--
-- This mirrors the live table exactly and is a no-op against it. Its only job
-- is to give 0001 something to attach a foreign key to on a fresh database.
--
-- The 'shadesofirony' default is legacy: every row predating multi-account came
-- from that one account, and 0001 turns this column into a foreign key.

create table if not exists public.posted_urls (
  id        bigserial primary key,
  url       text not null,
  posted_at timestamptz default now(),
  account   text not null default 'shadesofirony'
);

comment on table public.posted_urls is
  'Dedupe memory, capped at 100 rows per account. A story one account posted stays available to the others.';

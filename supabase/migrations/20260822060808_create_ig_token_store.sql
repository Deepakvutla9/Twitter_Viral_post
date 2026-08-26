-- Recorded in the remote migration history as 20260822060808, applied by an
-- earlier session through the Supabase MCP with no file in the repository.
-- Reconstructed here from the live schema. Do not re-run against production.
--
-- Single-row token store, superseded before it was ever used: it holds one token
-- for one account, which is exactly the assumption multi-account removes.
-- 20260826180223 adds ig_tokens (plural), keyed by account. This table is empty
-- and referenced by no code. Left in place rather than dropped so the history
-- replays honestly; drop it in its own migration once ig_tokens is carrying the
-- live token.

-- Production carries two identical CHECK ((id = 1)) constraints on this table:
-- ig_token_id_check, auto-named from the inline check, and ig_token_singleton,
-- named explicitly. The duplication is redundant and was presumably not
-- intended, but a reconstruction that quietly drops one does not reproduce the
-- database it claims to describe. Both are kept so a replay matches exactly.
-- If it is ever cleaned up, that belongs in a new migration, not in this one.
create table if not exists public.ig_token (
  id           smallint primary key default 1 check (id = 1),
  token        text not null,
  expires_at   timestamptz,
  refreshed_at timestamptz not null default now(),
  constraint ig_token_singleton check (id = 1)
);

alter table public.ig_token enable row level security;

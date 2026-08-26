-- Step 1 of multi-account: one row per posting account, tokens kept apart.
-- Applied to project ref (see Render env SUPABASE_URL) on 2026-08-26.

create table if not exists public.accounts (
  slug          text primary key,
  display_name  text not null,
  handle        text not null,
  ig_user_id    text,
  accent        text not null default '#00e5ff',
  cron          text not null default '0 */6 * * *',
  slot_plan     text[] not null default '{tech,visa,trump,visa}',
  hashtag_extra text[] not null default '{}',
  groq_model    text,
  active        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.accounts is 'One row per Instagram account Frontrun posts to. Config only - no secrets.';
comment on column public.accounts.slug is 'Stable key used by posted_urls.account and ig_tokens.account_slug.';
comment on column public.accounts.active is 'Autopilot only fans out to active accounts.';

-- Tokens live in their own table so accounts stays readable with the anon key
-- while secrets need the service role. RLS on with no policy = anon blocked.
create table if not exists public.ig_tokens (
  account_slug text primary key references public.accounts(slug) on delete cascade,
  token        text not null,
  expires_at   timestamptz,
  refreshed_at timestamptz not null default now()
);
alter table public.ig_tokens enable row level security;

comment on table public.ig_tokens is 'Long-lived IG token per account. Service-role only; refreshed in place so a restart never loses it.';

-- Seed the account that is already posting. Its slug matches the default that
-- posted_urls.account has been writing all along, so the FK below needs no backfill.
insert into public.accounts (slug, display_name, handle, ig_user_id, active)
values ('shadesofirony', 'Synthetic Minds', '@shadesofirony', '26924862140533740', true)
on conflict (slug) do nothing;

alter table public.posted_urls
  add constraint posted_urls_account_fkey
  foreign key (account) references public.accounts(slug);

-- Dedupe memory is per account: a story one account posted must stay available
-- to the others. Cross-account overlap is a separate cooldown policy, not this.
create unique index if not exists posted_urls_account_url_key
  on public.posted_urls (account, url);

create index if not exists posted_urls_account_posted_at_idx
  on public.posted_urls (account, posted_at desc);

-- Step 1 of multi-account: one row per posting account, tokens kept apart.
-- Already applied; recorded in the remote history as 20260826180223.

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
--
-- ig_user_id is deliberately left null and active false: the real value is
-- configuration, not something to publish in a public repository. A fresh
-- database therefore starts with an account that accounts.js reports as
-- unusable until it is filled in, which is the intended failure - loud and
-- specific, rather than a plausible-looking wrong id.
--
--   update public.accounts set ig_user_id = '...', active = true
--   where slug = 'shadesofirony';
--
-- ON CONFLICT DO NOTHING means replaying this against the live database leaves
-- the configured row untouched.
insert into public.accounts (slug, display_name, handle, ig_user_id, active)
values ('shadesofirony', 'Synthetic Minds', '@shadesofirony', null, false)
on conflict (slug) do nothing;

-- Guarded so the whole file can be replayed. ADD CONSTRAINT has no IF NOT
-- EXISTS form, and re-running it against the live schema would abort.
do $$
begin
  if not exists (
    -- Scoped to the table and constraint type: constraint names are only unique
    -- per table, so matching on name alone would skip creating this foreign key
    -- if some unrelated table ever carried the same name.
    select 1 from pg_constraint
    where conrelid = 'public.posted_urls'::regclass
      and conname  = 'posted_urls_account_fkey'
      and contype  = 'f'
  ) then
    alter table public.posted_urls
      add constraint posted_urls_account_fkey
      foreign key (account) references public.accounts(slug);
  end if;
end $$;

-- Dedupe memory is per account: a story one account posted must stay available
-- to the others. Cross-account overlap is a separate cooldown policy, not this.
create unique index if not exists posted_urls_account_url_key
  on public.posted_urls (account, url);

create index if not exists posted_urls_account_posted_at_idx
  on public.posted_urls (account, posted_at desc);

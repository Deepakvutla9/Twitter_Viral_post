-- Voice is style only. Source grounding and the number/date verification rules
-- live in the prompt as immutable sections that no account can override.
alter table public.accounts
  add column if not exists voice jsonb not null default '{}'::jsonb,
  add column if not exists timezone text not null default 'UTC';

comment on column public.accounts.voice is
  'Style constraints only: {tone, audience, avoid[]}. Never grounding or factual rules.';
comment on column public.accounts.timezone is
  'IANA zone the cron field is read in. Everything defaults to UTC.';

-- accent is injected into raw SVG, so constrain it at the database edge too.
alter table public.accounts
  drop constraint if exists accounts_accent_hex_check;
alter table public.accounts
  add constraint accounts_accent_hex_check check (accent ~ '^#[0-9a-fA-F]{6}$');

alter table public.accounts
  drop constraint if exists accounts_slug_format_check;
alter table public.accounts
  add constraint accounts_slug_format_check check (slug ~ '^[a-z0-9][a-z0-9_-]{1,38}$');

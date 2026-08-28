-- Which drawn mark an account uses in place of the name pill.
--
-- A key into a registry of designs in imageComposer.js, never the artwork
-- itself: that string is interpolated straight into the slide's SVG, so raw
-- markup here would be an injection rather than a logo. Null keeps the pill.
alter table public.accounts
  add column if not exists logo text;

comment on column public.accounts.logo is
  'Key into the MARKS registry in services/imageComposer.js (monogram, cap, wordmark). Null draws the name pill. Never raw SVG.';

alter table public.accounts
  drop constraint if exists accounts_logo_format_check;
alter table public.accounts
  add constraint accounts_logo_format_check
  check (logo is null or logo ~ '^[a-z][a-z0-9-]{1,30}$');

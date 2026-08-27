# Migrations

The database was built by hand and by MCP calls before this directory existed.
That history is now reconstructed here, but reconciling it needs one deliberate
step before anyone runs the CLI against production. Read this first.

## Why the versions look the way they do

The Supabase CLI takes a migration's version from the digits **before the first
underscore** in the filename. Names like `20260826_0001_thing.sql` therefore all
resolve to version `20260826` and collide. Every file here uses a unique 14-digit
UTC timestamp, and where a migration already exists remotely, the filename uses
**the exact version the remote recorded** so local and remote history line up
without a repair.

## Current state

| Version | Name | In remote history | Notes |
|---|---|---|---|
| `20260821000000` | `baseline_posted_urls` | **No** | Table predates all history. Mark applied; do not run. |
| `20260821173306` | `add_account_to_posted_urls` | Yes | Reconstructed from the live schema. |
| `20260822060808` | `create_ig_token_store` | Yes | Reconstructed. Empty table, superseded by `ig_tokens`. |
| `20260826180223` | `multi_account_data_model` | Yes | accounts, ig_tokens, FK, per-account dedupe index. |
| `20260826181208` | `accounts_voice_and_timezone` | Yes | voice, timezone, accent/slug CHECK constraints. |
| `20260827210031` | `enable_rls_on_accounts_and_posted_urls` | Yes | RLS on, no policies — service role only. |

Confirm before trusting this table:

```bash
supabase migration list
```

## Reconciling, once

Only `20260821000000_baseline_posted_urls` is missing from the remote history,
because `posted_urls` was created in the dashboard long before migrations were
tracked. Mark it applied rather than running it — the table already exists, and
running it would do nothing useful while claiming to have built the schema:

```bash
supabase migration repair --status applied 20260821000000
```

Then `supabase migration list` should show every version present both locally and
remotely, with nothing pending.

## Rules

- **Never `supabase db push` at production to fix history.** Every migration here
  is already applied there except the baseline, which must be repaired, not run.
  Pushing is for genuinely new migrations, after history reconciles.
- **Replayability is proven.** `supabase db reset` was run against a disposable
  local database on 2026-08-27: all five migrations applied from scratch, then
  replayed again on reset. The rebuilt schema was compared to production column
  by column and constraint by constraint — 26 columns, 16 constraints and
  indexes, and the RLS flags all match exactly.

  Re-run it after changing any migration:

  ```bash
  supabase start && supabase db reset --local
  ```

  This is a local stack only. Do not `supabase link` this project to production.
- **`ig_token` (singular) is dead.** Empty, referenced by no code, superseded by
  `ig_tokens`. Drop it in its own migration once the live token is in `ig_tokens`,
  not by editing history.
- **No credentials or account ids in migration files.** This repository is public.
  The seed row in `20260826180223` deliberately leaves `ig_user_id` null and
  `active` false; the real values are set out of band.

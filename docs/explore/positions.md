# Explore: positions table (#12)

Read-only survey before planning the `positions` table with owner-only RLS. No code was changed.

## The issue

Issue #12 (Sprint 1, assigned to Nakul, blocks #1, #2 and #4, depends on #11). Acceptance criteria:

- A migration creates `positions`: `id`, `user_id` (references profiles), `ticker` (stored uppercase), `quantity` (numeric, fractional allowed), `cost_basis_cents` (integer), `source` (csv, screenshot, manual, brokerage), `created_at`, `updated_at` (UTC).
- Unique on `(user_id, ticker)`.
- RLS: a user can create, read, update and delete only their own positions.
- A test or written check shows user A cannot read user B's positions.
- A TypeScript row type and a zod schema are exported for #1, #2 and #4.
- Money is never stored or computed as floating point.
- Club portfolios are out of scope (they come with #6).

## What exists today

| Path | Relevance |
|---|---|
| `supabase/migrations/20261126003040_create_profiles.sql` | The only migration. Sets the pattern to copy. |
| `supabase/tests/profiles-rls.sql` | Written RLS check, run by hand in the Supabase SQL Editor. |
| `lib/db/` | `server.ts` (RLS-bound client), `admin.ts` (service role, bypasses RLS), `current-user.ts` (`requireUser`), `profiles.ts` (the one data-access module), `env.ts`, `browser.ts`. |
| `lib/domain/money.ts` | `dollarsToCents(string): number`, digit-based, rejects non-safe integers. |

### Profiles migration pattern

- `id uuid primary key references auth.users (id) on delete cascade`.
- `created_at timestamptz not null default now()` (comment: timestamptz is stored in UTC).
- `enable row level security`, then `revoke all ... from anon, authenticated`, then explicit narrow grants (including column-level `grant update (display_name)`), because Supabase's default privileges otherwise grant everything.
- Policies are named `"profiles: read own row"` and use `(select auth.uid()) = id` (the subselect form, so it is evaluated once per statement).
- Update policy has both `using` and `with check`.
- Check constraints are inline (`display_name` length).
- Functions that must not be callable are `revoke execute ... from public, anon, authenticated`.

### Profiles RLS test pattern

- One transaction ending in `rollback`; a final `select 'profiles RLS: all checks passed'` after the rollback.
- Fixed UUIDs (`...00a`, `...00b`) inserted into `auth.users` as postgres.
- `set local role authenticated` plus `set_config('request.jwt.claims', ...)` to impersonate a user; `reset role` to go back.
- Cross-user write attempts: assert `row_count = 0`. Forbidden operations: `begin ... exception when insufficient_privilege then null`.
- A check for `anon`, and a final check as postgres that B's data is untouched.

### TypeScript access pattern (`lib/db/profiles.ts`)

- `import "server-only"`; `requireUser()` first; `createServerSupabase()`; query; `if (error) throw new Error("<friendly message>")`.
- Maps snake_case DB columns to a camelCase app type (`display_name` to `displayName`) by hand.
- `"use cache: private"` on per-user reads (see the comment there).
- Tests mock `./current-user` and `./server` with a chained fake (`from` / `select` / `eq` / `maybeSingle`).
- There are no generated Supabase types and no zod schema for rows yet. zod is currently used for env and external data.

## Design sketch

```sql
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  ticker text not null check (ticker = upper(ticker) and ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  quantity numeric not null check (quantity > 0),
  cost_basis_cents bigint|integer not null check (cost_basis_cents >= 0),
  source text not null ...,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ticker)
);
```

- RLS on; `revoke all` from `anon` and `authenticated`; grant `select, insert, delete` and column-limited `update (quantity, cost_basis_cents, source)` to `authenticated`. That keeps `id`, `user_id`, `ticker` and the timestamps immutable from the client.
- Four policies (select, insert, update, delete), each `(select auth.uid()) = user_id`; insert and update use `with check` so a user cannot insert or reassign a row to someone else.
- The unique constraint already creates an index on `(user_id, ticker)`, which also serves the RLS filter on `user_id`.
- Delete cascades from profiles, which cascades from `auth.users`.
- New `supabase/tests/positions-rls.sql` in the same style: A and B each get a position; A sees only theirs, cannot update, delete or insert as B, cannot reassign `user_id`, duplicate ticker fails, lowercase ticker is rejected, anon sees nothing.
- New `lib/db/positions.ts` (or a domain file) exporting the row type and zod schema. Most likely the schema lives where #1, #2 and #4 can import it without pulling in `server-only` (see question 9).

## Open questions

1. **`cost_basis_cents`: `bigint` or `integer`?** The issue says integer. Postgres `integer` tops out at 2,147,483,647 cents, about $21.4 million, per position. That is enough for retail users but a club or a large holding could exceed it, and an overflow is a hard insert error. `bigint` goes to about 9.2e18, but PostgREST returns it as a JSON number, which is only exact to 2^53 (about $90 trillion), far beyond any realistic value, so it is safe as a JS `number`. `dollarsToCents` already rejects values that are not safe integers. Is `bigint` an acceptable reading of "integer"? Is the cost basis per position in total (assumed here) or per share? Per share would need sub-cent precision, which cents cannot hold.
2. **How does `quantity` (numeric) arrive in TypeScript?** PostgREST serialises `numeric` as a JSON number, so supabase-js gives a JS `number` (a float), and digits beyond double precision are lost silently. That is fine for share counts like `1.5` or `0.123456`, but it breaks the "no floating point" spirit if quantity is later multiplied by prices. Options: (a) accept `number` and constrain scale in the DB (`numeric(18,6)`) so the value round-trips; (b) cast to text in the select (`quantity::text`, via a view or RPC) and carry a decimal string in the zod schema; (c) a decimal library. Which does the team want, and what maximum scale do broker CSVs need (6 decimals is common, some brokers go to 8 or 9)? Portfolio math in `lib/domain/` will have to multiply quantity by price in integer cents, so rounding rules for that are also needed.
3. **`source`: Postgres enum or `text` plus a check constraint?** The profiles migration uses inline check constraints. A check constraint is easier to change (add `'plaid'` or similar later without `alter type` restrictions) and maps cleanly to a zod `z.enum`. A Postgres enum is more self-documenting but harder to alter and remove values from. Recommendation is `text` plus check, matching existing style. Confirm? Should `source` be `not null` with no default, or default to `'manual'`?
4. **How does `updated_at` get updated?** Options: (a) a `before update` trigger function setting `new.updated_at = now()` (reliable whoever writes, but it is a second function to `revoke execute` on, like `handle_new_user`); (b) the app sets it on each write (easy to forget, and only works if the column is granted for update); (c) the `moddatetime` extension. Recommendation is (a), with `updated_at` left out of the client's column grants so it cannot be forged. Is a shared reusable `set_updated_at()` function wanted for future tables (#6 clubs, alerts), or a positions-specific one?
5. **Ticker normalisation.** "Stored uppercase": enforce with a check constraint only (reject lowercase), or also normalise with a trigger or in the app? Recommendation is check constraint plus uppercasing and trimming in the zod schema (transform before parse), so the DB never silently rewrites input. What ticker format should be allowed (class shares like `BRK.B` or `BRK-B`, length cap)? EDGAR's ticker format may differ from the broker's.
6. **Quantity and cost basis bounds.** Must `quantity` be `> 0`, or can a position be zero or negative (shorts)? Should `cost_basis_cents` allow `0` (gifted or spun-off shares)? Is cost basis nullable for screenshot imports that lack it? The issue says integer, implying `not null`.
7. **Insert and update semantics for imports.** Re-importing a CSV for a ticker the user already holds hits the unique constraint. Is the app expected to upsert (needs both insert and update grants, and RLS passes through `on conflict do update`), or is merging a #1 concern? For upsert, `source` would need to be updatable, as assumed in the sketch.
8. **Verification: written check only, or also automated?** Acceptance accepts "a test or written check". Matching `profiles-rls.sql` (run by hand in the SQL Editor) is the plan. Is there appetite for a local Supabase (CLI plus pgTAP) in CI, or is the SQL Editor script enough for now? Do we apply the migration to the hosted project ourselves, or does Dhanraj?
9. **Where do the row type and zod schema live?** `lib/db/profiles.ts` is `server-only` and hand-maps columns. If the zod schema sits in `lib/db/`, client components (e.g. an import-preview form in #1) cannot import it. Options: `lib/domain/position.ts` (pure, importable anywhere, schema plus type), with `lib/db/positions.ts` doing the queries and the snake_case to camelCase mapping. Should the exported "row type" be the raw snake_case row, the camelCase app type, or both? Should the zod schema also validate rows coming back from Supabase (matching "validate external data at the boundary") rather than trusting the client's types?
10. **Data-access functions in scope?** The issue lists only the migration, the test and the exports. Should #12 also ship `lib/db/positions.ts` read and write functions, or leave those to #1, #2 and #4 so they don't conflict?
11. **Dependency on #11.** The issue says "references profiles", and the profiles migration already exists, so the dependency looks satisfied. Is #11 otherwise still open, and does anything from it change the profiles shape?
12. **Migration filename.** The existing one is `20261126003040_create_profiles.sql` (a timestamp from today). Use the same scheme with a later timestamp, e.g. `..._create_positions.sql`?

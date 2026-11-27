# Plan: positions table with owner-only RLS (#12)

## Context
Issue #12 (Sprint 1) blocks #1 (import), #2 (dashboard) and #4 (theses). #11 is done: `profiles` exists, so `positions.user_id` can reference it. This plan adds the table, its RLS, a hand-run RLS test, a pure zod schema and row type, and three small data-access functions. Club portfolios stay out of scope (#6). Pattern source: `supabase/migrations/20261126003040_create_profiles.sql`, `supabase/tests/profiles-rls.sql`, `lib/db/profiles.ts`.

## Decisions (from you)
- `cost_basis_cents bigint not null check (>= 0)`: TOTAL cost of the position, not per share.
- `quantity numeric(18,6) not null check (> 0)`: read as a string in TypeScript (`quantity::text` in queries). Decimal library is chosen later in #2.
- `source text not null` with a check constraint: `csv | screenshot | manual | brokerage`. No default (my assumption; say if you want `'manual'`).
- One shared `set_updated_at()` trigger function. Clients cannot write `updated_at`.
- `ticker text not null check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$')`. The regex already forces uppercase, so no separate `upper()` check. The zod schema trims and uppercases.
- `unique (user_id, ticker)`; re-import is an upsert that replaces the row. Full re-import rules belong to #1.
- Schema and row type in `lib/domain/positions.ts` (no db imports). `lib/db/positions.ts` is small: list, upsert, delete. RLS check in `supabase/tests/positions-rls.sql`.

## One risk to settle early: upsert vs column grants
PostgREST's upsert (`on conflict do update`) sets every column in the payload, including `user_id` and `ticker`. Postgres then needs column-level UPDATE privilege on those columns. So the grants are:
- `grant insert (user_id, ticker, quantity, cost_basis_cents, source)`
- `grant update (user_id, ticker, quantity, cost_basis_cents, source)`
- `grant select, delete`
- `id`, `created_at`, `updated_at` are never client-writable. The update policy's `with check` stops anyone reassigning `user_id`. The cost is that an owner can rename their own ticker (still regex-checked and unique), which I think is harmless.

I cannot run Postgres here (no Docker, psql or CLI), so this is unproven until the RLS script runs. The script includes an upsert as an authenticated user. **Fallback if it fails:** an invoker-rights RPC `upsert_position(...)` that sets only the three data columns and takes `user_id` from `auth.uid()`.

## Files
Migrations (timestamps taken from the UTC clock at implementation, later than `20261126003040`):
1. `supabase/migrations/<ts1>_create_set_updated_at.sql`: `set_updated_at()` returns trigger, `set search_path = ''`, sets `new.updated_at = now()`; `revoke execute ... from public, anon, authenticated` (same as `handle_new_user`).
2. `supabase/migrations/<ts2>_create_positions.sql`: table (`id uuid default gen_random_uuid()`, `user_id` references `profiles (id) on delete cascade`, columns above, `created_at`/`updated_at timestamptz not null default now()`), `unique (user_id, ticker)` (its index also serves the RLS filter), `before update` trigger calling `set_updated_at()`, RLS on, `revoke all` from anon and authenticated, grants above, four policies named `"positions: <verb> own rows"` using `(select auth.uid()) = user_id` (insert and update with `with check`).

Tests and code:
3. `supabase/tests/positions-rls.sql`: one transaction ending in `rollback`, fixed UUIDs, `set local role` plus `request.jwt.claims`, ends with `select 'positions RLS: all checks passed'`.
4. `lib/domain/positions.ts` (+ `.test.ts`): exports `POSITION_SOURCES`, `tickerSchema`, `quantitySchema`, `costBasisCentsSchema`, `positionInputSchema`/`PositionInput` (camelCase: `ticker, quantity, costBasisCents, source`), `positionRowSchema`/`PositionRow` (snake_case, exactly what the DB returns). Zod 4 (`^4.6.7`): `z.string().trim().toUpperCase().regex(...)`, `z.int()`, `z.iso.datetime({ offset: true })` (PostgREST returns `+00:00` offsets).
   - `quantitySchema` is a decimal string: `^\d{1,12}(\.\d{1,6})?$`, and not all zeros. It rejects JS numbers and more than 6 decimals rather than rounding.
   - `costBasisCentsSchema` is a safe non-negative integer. It reuses nothing from `money.ts` (that parses dollar strings).
5. `lib/db/positions.ts` (+ `.test.ts`), `import "server-only"`, `requireUser()` first, `createServerSupabase()`, friendly errors as in `profiles.ts`:
   - `listMyPositions(): Promise<PositionRow[]>`: select explicit columns with `quantity::text`, `.eq("user_id", user.id)` (belt and braces with RLS), order by ticker, parse each row with `positionRowSchema`.
   - `upsertMyPosition(input: PositionInput): Promise<PositionRow>`: parse input, `.upsert({ user_id: user.id, ...snake_case }, { onConflict: "user_id,ticker" }).select(cols).single()`.
   - `deleteMyPosition(ticker: string): Promise<void>`: normalise with `tickerSchema`, `.delete().eq("user_id", ...).eq("ticker", ...)`.
   - No `"use cache: private"` yet: the list changes on every write, and #2 decides how the dashboard caches and revalidates it.
   - Reads return the snake_case `PositionRow`, writes take camelCase `PositionInput` (differs from `profiles.ts`, which maps by hand; this keeps the mapping to one place).

## Tests: one red/green pair per criterion
Order is test first, then the minimum code. SQL pairs: the red state cannot be demonstrated on this machine, so each red commit records test-first order and the real run happens once in the SQL Editor (it fails before the migration, passes after). The migration grows across pairs 1 to 4 (unpushed, so editing it is fine). Domain and db pairs run in Vitest with red verified.

**Pair 1: columns, types, constraints (criterion 1).** SQL checks:
- columns and types via `information_schema`: `quantity` is numeric(18,6), `cost_basis_cents` is bigint, timestamps are `timestamptz`, `source` is text
- `source` accepts the four values, rejects `'plaid'` and `NULL`
- ticker accepts `A` and `BRK.B`, rejects `brk.b`, `1ABC`, an 11-character ticker and `''`
- quantity rejects `0` and `-1`; accepts `0.123456`; a 7th decimal is rounded away by the type, so the app-side zod guard matters
- `cost_basis_cents` rejects `-1`, accepts `0`
- `user_id` pointing at a missing profile fails (FK); deleting the auth user cascades the positions away
- `updated_at`: insert as postgres with `created_at = updated_at = '2000-01-01'` (inserts don't fire the trigger), update `quantity`, assert `updated_at > '2000-01-01'` and `created_at` unchanged (now() is constant within a transaction, hence the old seed)

Green: both migration files, table and trigger parts.

**Pair 2: uniqueness (criterion 2).**
- a second `(user_id, ticker)` row raises `unique_violation`
- the same ticker for a different user is fine
- `insert ... on conflict (user_id, ticker) do update` replaces quantity, cost and source and leaves one row

Green: the `unique` constraint.

**Pair 3: RLS create/read/update/delete own rows only (criterion 3).** As A (JWT claims):
- select returns exactly A's rows
- insert for A works; insert with `user_id` = B fails (`row-level security` error, 42501)
- upsert for A (the grants risk above) replaces A's row
- update A's quantity: 1 row; update B's row: 0 rows
- update `user_id` to B fails; update `id`, `created_at` or `updated_at` fails with `insufficient_privilege`; update ticker to a lowercase value fails the check
- delete B's row: 0 rows; delete A's: 1 row
- as `anon`: select fails with `insufficient_privilege`

Green: `enable row level security`, revoke, grants, four policies.

**Pair 4: A cannot read B (criterion 4).** As A: `count(*) where user_id = B` is 0, select by B's row id returns 0 rows, and a join on B's ticker finds nothing. Back as postgres: B's rows are unchanged (quantity, cost, `updated_at`). Green: none new beyond pair 3's policies; this block proves them from the read side. Its red is only meaningful if run against a build with the select policy missing, so I will run it once with the policy commented out in the SQL Editor to confirm the check can fail.

**Pair 5: row type and zod schema exported (criterion 5)**, `lib/domain/positions.test.ts`:
- ticker: `"  brk.b "` becomes `"BRK.B"`; accepts `A`, `BRK-B` and 10 characters; rejects `""`, `1ABC`, 11 characters, `AB CD`, `AB$`
- source: accepts the four values, rejects `plaid` and `""`
- `positionInputSchema`: valid input parses with an uppercased ticker and the quantity string untouched; a missing field fails
- `positionRowSchema`: parses a PostgREST-shaped row (`+00:00` timestamps, string quantity, number cost); rejects a non-uuid `id`; rejects a numeric `quantity` (so a forgotten `::text` cast fails loudly)

Green: `lib/domain/positions.ts`.

**Pair 6: money never floating point (criterion 6)**, same test file, new `describe`:
- cost basis accepts `0` and `12345`; rejects `-1`, `1.5`, `2**53`, `NaN`, and the string `"100"`
- quantity accepts `"1"`, `"0.5"`, `"123456.123456"`, `"999999999999.999999"`; rejects `"0"`, `"0.000000"`, `"-1"`, `"1e3"`, `"1.1234567"`, `"1234567890123"`, `""`, `"abc"` and the number `1.5`
- SQL side is covered by pair 1's column-type checks

Green: tighten the quantity and cost schemas (if pair 5's green already satisfies them, the red commit is skipped and noted).

**Pair 7: data-access functions (your addition)**, `lib/db/positions.test.ts` with the chained fake client:
- list: queries `positions` with explicit columns including `quantity::text`, `.eq("user_id", "user-a")`, ordered by ticker; returns rows with `quantity` still a string (`"0.123456"`); throws "Could not load your positions." on error; throws when a row fails the schema; no query when `requireUser` rejects
- upsert: payload is snake_case with `user_id` from `requireUser` even if the input smuggles a different `user_id`; ticker uppercased; `onConflict: "user_id,ticker"`; invalid input throws before any query; error becomes "Could not save your position."
- delete: `.delete().eq("user_id", ...).eq("ticker", "BRK.B")` with a normalised ticker; an invalid ticker never queries; error becomes "Could not delete your position."

Green: `lib/db/positions.ts`.

**Criterion 7 (clubs out of scope):** nothing to build and no test. It is guarded by review: no club table, column or policy in the migration.

## Applying and verifying
- `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass.
- Apply both migrations with the same method used for profiles (`npx supabase db push --dry-run`, then `db push`; or the dashboard SQL Editor, but not both). Open question: who applies it, you or Dhanraj.
- Run `supabase/tests/positions-rls.sql` in the SQL Editor and look for `positions RLS: all checks passed`. If the upsert check fails, switch to the RPC fallback above.
- Table Editor shows RLS enabled on `positions`.

## Commits (on `feat/positions`, no push)
`docs:` this plan, then per pair `test(red):` and `feat(green):` (plus `refactor:` where useful). SQL pairs 1 to 4 first, then pairs 5 to 7. Every commit ends with the Co-Authored-By line.

## Known gaps
- `upsertMyPosition` is covered only by unit tests against a fake client. No screen calls it yet, so the real PostgREST upsert is first exercised in #1 (import). Until then, the SQL test only imitates the request PostgREST sends.

## Out of scope
Import parsing and re-import merge rules (#1), a decimal library and portfolio math (#2), clubs (#6), generated Supabase types, pgTAP or local Supabase in CI.

## On approval
Save this as `docs/plans/positions.md`, commit it as `docs: plan the positions table for #12`, and stop. No implementation.

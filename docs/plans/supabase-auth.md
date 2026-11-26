# Plan: Supabase project and email auth (#11)

## Context
Issue #11 blocks #12, #1, #2, #4, #5, #6 and #7: every story except pure logic needs a database and signed-in users. The repo is still the scaffold plus `lib/domain/citation-check.ts` and `lib/agents/report-pipeline.ts`. No Supabase packages, no `lib/db/`, no `supabase/` folder, no Supabase CLI, Docker or psql on this machine. The hosted Supabase project is created by hand in the browser; this plan covers everything in the repo plus the dashboard steps.

Decisions already made:
- **Email confirmation is off for now** (dashboard setting). Sign-up logs the user straight in, so there is no `/auth/confirm` route yet. Open a follow-up issue to turn it back on before launch.
- **Next 16 renamed `middleware.ts` to `proxy.ts`** (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). The issue's "middleware" is implemented as `proxy.ts` exporting `proxy`.
- **Cache Components is on**, so any component that reads cookies must sit behind `<Suspense>` (`02-guides/authentication-with-cache-components.md`). The proxy is an optimistic check only; pages re-check the user on the server (Data Access Layer pattern).

## Step 0: unblock `.env.example`
1. `.claude/settings.json`: replace the deny rule `Read(.env*)` with rules for only the real env files:
   `Read(./.env)`, `Read(./.env.local)`, `Read(./.env.*.local)`, `Read(./.env.development)`, `Read(./.env.production)`, `Read(./.env.test)`. Needs your approval. Commit: `chore: narrow env deny rule so .env.example is readable`.
2. `.gitignore`: it ignores `.env*` (twice), which would also ignore `.env.example`. Add `!.env.example` after the last `.env*` line. `.env.local` stays ignored.
3. `.env.example` (names only, no values):
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```
   The publishable key slot also accepts the legacy anon key. Copy the values into `.env.local` yourself; I never read it.

## Dependencies (`npm install`, needs approval; reasons go in the commit message)
- `@supabase/supabase-js`: the Postgres/Auth client. Runtime dependency.
- `@supabase/ssr`: stores the Supabase session in cookies so server components, server actions and `proxy.ts` all see the same signed-in user. Runtime dependency.
- `server-only`: makes a build fail if a server module is imported from a client component. Next only ships a private copy under `next/dist/compiled`, so it is added explicitly. Runtime dependency.
Commit: `chore(deps): add Supabase clients and server-only (#11)`.

## Files

### `lib/db/` (clients)
- `lib/db/env.ts`: `publicEnv()` parses `{ url: process.env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }` with zod (`url()`, non-empty string). The `process.env.NEXT_PUBLIC_*` reads stay literal so Next inlines them in the browser bundle. Throws a clear error naming the missing variable.
- `lib/db/browser.ts`: `createBrowserSupabase()` with `createBrowserClient` from `@supabase/ssr`.
- `lib/db/server.ts`: `import "server-only"`. `createServerSupabase()` = `createServerClient(url, key, { cookies: { getAll, setAll } })` over `await cookies()`. `setAll` is wrapped in try/catch because server components can't set cookies (the proxy refreshes them).
- `lib/db/admin.ts`: `import "server-only"`. `createAdminSupabase()` reads `SUPABASE_SERVICE_ROLE_KEY` (zod-validated) and creates a `@supabase/supabase-js` client with `auth: { persistSession: false, autoRefreshToken: false }`. Nothing uses it yet; it exists so the key has exactly one home, and that home can't be bundled for the browser.
- `lib/db/session.ts`: `updateSession(request: NextRequest)`. Builds a server client over request/response cookies, calls `supabase.auth.getClaims()` (verifies the JWT and refreshes the session), then applies `authRedirect` (below). Returns the response with refreshed cookies copied onto any redirect.
- `lib/db/current-user.ts`: `import "server-only"`. `requireUser()` calls `getClaims()`; if there is no user it calls `redirect("/login")`, otherwise returns `{ id, email }`. Every protected page and server action calls this, so protection doesn't depend on the proxy.

### `lib/domain/auth-redirect.ts` (pure, strict TDD)
- `isPublicPath(pathname)`: allowlist. Public: `/`, `/login`, `/signup`. Everything else is protected, so new pages are protected by default.
- `safeNextPath(next: string | null)`: returns `next` only if it is a same-site path (starts with `/`, not `//` or `/\`, no scheme); otherwise `/dashboard`. Prevents open redirects through `?next=`.
- `authRedirect({ pathname, search, signedIn })`: returns `null` or a redirect target. Signed out on a protected path → `/login?next=<path+search>`. Signed in on `/login` or `/signup` → `/dashboard`.

### `proxy.ts` (repo root)
`export async function proxy(request) { return updateSession(request) }`, with a matcher that skips `_next/static`, `_next/image`, `favicon.ico` and image files (pattern from `proxy.md`).

### `supabase/migrations/<UTC timestamp>_create_profiles.sql`
```sql
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  created_at timestamptz not null default now()   -- timestamptz is stored in UTC
);

alter table public.profiles enable row level security;

-- Supabase's default privileges grant everything to anon/authenticated; start from nothing.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;  -- id and created_at can't change

create policy "profiles: read own row" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own row" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- No insert/delete policies: rows are created by the trigger and removed by the cascade.

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```
Signed-out (`anon`) users have no grant and no policy, so they see nothing.

### `supabase/tests/profiles-rls.sql` (SQL test, run in the dashboard SQL editor)
No CLI or Docker here, so this is a plain SQL script rather than pgTAP. It runs in one transaction and ends in `rollback`, so it leaves nothing behind. Each check is a `do $$ ... $$` block that `raise exception`s on failure:
1. As `postgres`: insert two users into `auth.users` (one with `display_name` metadata). Assert the trigger created both profiles and the display name was trimmed.
2. `set local role authenticated` and `set_config('request.jwt.claims', '{"sub":"<user A>","role":"authenticated"}', true)`:
   - selecting all profiles returns exactly 1 row (A's);
   - updating B's `display_name` affects 0 rows;
   - updating A's `display_name` affects 1 row;
   - updating A's `id` or `created_at` fails with `insufficient_privilege` (caught and asserted);
   - inserting and deleting a profile fail.
3. `set local role anon`: selecting profiles fails with `insufficient_privilege` or returns 0 rows.
4. `rollback`.
The script prints `profiles RLS: all checks passed` via `raise notice` at the end. The PR also includes a short written manual check (two browser sessions, each can see only its own profile).

### `app/` (UI)
- `app/(auth)/actions.ts` (`"use server"`): `signUp`, `logIn`, `logOut`. Each parses `FormData` with zod (email; password min 8 chars; optional display name 1–50 chars), calls `createServerSupabase().auth.signUp({ email, password, options: { data: { display_name } } })` / `signInWithPassword` / `signOut`, then `redirect(safeNextPath(next))` or `redirect("/login")`. Errors return `{ error: string }` for `useActionState`. Login always shows "Email or password is incorrect" (no account enumeration).
- `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`: static shell; the form is a client component (`auth-form.tsx`) using `useActionState`, behind `<Suspense>` because it reads `next` with `useSearchParams`.
- `app/dashboard/page.tsx`: placeholder protected page. A `<Suspense>`-wrapped server component calls `requireUser()`, reads the user's profile through the server client (proving RLS works end to end) and shows the display name plus a logout form.
- `app/page.tsx`: replace the scaffold with a short landing page linking to log in and sign up. `app/layout.tsx`: set the real title and description.
Read `02-guides/authentication.md` and the `useActionState`/server action docs in `node_modules/next/dist/docs/` before writing these.

## Tests (Vitest, no network; Supabase is mocked with `vi.mock`)
`server-only` is mocked to an empty module in tests that import server modules.

**Cycle 1, `lib/domain/auth-redirect.test.ts`** (strict TDD: `test(red)` → `feat(green)` → `refactor`)
- `isPublicPath`: `/`, `/login`, `/signup` are public; `/dashboard`, `/dashboard/x`, `/loginx` are not
- `safeNextPath`: keeps `/dashboard?tab=1`; rejects `null`, `""`, `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:alert(1)`
- `authRedirect`: signed out on `/dashboard?x=1` → `/login?next=%2Fdashboard%3Fx%3D1`; signed out on `/login` → `null`; signed in on `/login` → `/dashboard`; signed in on `/dashboard` → `null`

**Cycle 2, `lib/db/session.test.ts`** (mock `@supabase/ssr` `createServerClient`; `getClaims` resolves to claims or `null`)
- signed out on a protected path → 307 to `/login?next=...`
- signed in on a protected path → passes through
- cookies written by `setAll` during refresh appear on the returned response, including on redirects

**Cycle 3, `app/(auth)/actions.test.ts`** (mock `@/lib/db/server` and `next/navigation` `redirect`)
- `signUp` with a bad email or short password returns a validation error and never calls Supabase
- `signUp` passes the trimmed display name as `options.data.display_name`
- `logIn` failure returns the generic message; success redirects to the safe `next`
- `logIn` with `next=//evil.com` redirects to `/dashboard`
- `logOut` calls `signOut` and redirects to `/login`

**Cycle 4, `lib/db/env.test.ts`**: `publicEnv()` throws naming the missing variable; accepts a valid pair (uses `vi.stubEnv`).

## Applying the migration to the hosted project
Option A, Supabase CLI through npx (recommended; no global install or Docker needed for `db push`):
1. `npx supabase login` (opens the browser).
2. `npx supabase link --project-ref <ref>` (the ref is in the project URL, `https://<ref>.supabase.co`). It asks for the database password you set when creating the project.
3. `npx supabase db push --dry-run`, check it lists only `<timestamp>_create_profiles.sql`, then `npx supabase db push`.
`link` creates `supabase/.temp/`; add it to `.gitignore`.

Option B, dashboard only: SQL Editor → New query → paste the migration file → Run. This works, but the CLI's migration history won't know about it, so pick one approach and stick with it.

Then in the dashboard:
- Authentication → Sign In / Providers → Email: turn **Confirm email** off (decided above).
- Run `supabase/tests/profiles-rls.sql` in the SQL Editor and check for the success notice.
- Table Editor → `profiles`: RLS shows as enabled.

## Commits (on `feat/supabase-auth`, no push)
`docs:` plan → `chore:` deny rule → `chore(deps):` packages → `chore:` env example and gitignore → TDD triplets per cycle → `feat:` migration and RLS test → `feat:` auth pages and dashboard.

## Verification
- `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` all pass.
- `grep -r "SUPABASE_SERVICE_ROLE_KEY\|service_role" .next/static` finds nothing (the key never reaches the browser).
- Manual, after the migration is applied and `.env.local` is filled in, with `npm run dev`:
  1. Signed out, open `/dashboard` → lands on `/login?next=%2Fdashboard`.
  2. Sign up with a display name → lands on `/dashboard` showing that name; a `profiles` row exists in the Table Editor.
  3. Log out → `/login`; `/dashboard` redirects again.
  4. Log in → returns to `/dashboard`. While signed in, `/login` redirects to `/dashboard`.
  5. Wrong password → generic error.
  6. Second account in a private window sees only its own display name.
- The RLS SQL test passes in the SQL Editor.

## Out of scope / follow-ups
- Turn email confirmation back on with an `/auth/confirm` route (new issue).
- Password reset, OAuth, profile editing UI.
- Generated database types (`supabase gen types`) once there are more tables.

# Explore: GitHub Actions CI (#13)

Read-only survey before planning CI. Nothing is implemented yet.

## What the issue asks for

- `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`.
- Steps: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`.
- Node version pinned (e.g. `.nvmrc`) and matching what we both use locally.
- No secrets needed; the build must pass without real keys.
- A test PR shows the checks passing.
- Branch protection on `main` requires CI (the repo owner sets this, not us).

## Current state

- No `.github/` folder and no `.nvmrc`. `package.json` has no `engines` or `packageManager` field.
- Scripts exist for `lint`, `test` (`vitest run --passWithNoTests`), `build`. There is no `typecheck` script, so CI calls `npx tsc --noEmit` directly (as CLAUDE.md says).
- Local toolchain on this machine: Node v26.13.1, npm 11.20.0. `package-lock.json` exists, so `npm ci` works.
- Environment variables read in code (by `grep process.env`):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`lib/db/env.ts`): zod-validated, **throws** if missing.
  - `SUPABASE_SERVICE_ROLE_KEY` (`lib/db/admin.ts`), `SEC_USER_AGENT` (`lib/data/edgar.ts`), `GEMINI_*`, `ANTHROPIC_API_KEY`, `REPORT_PROVIDER` (`lib/agents/`): read lazily inside functions.
- I did not read `.env*` files, per CLAUDE.md.

## Open questions

1. **Node version.** Local is Node 26.13.1. Is that Dhanraj's version too? Is 26 a current/LTS release that `actions/setup-node` supports, or should we pin an LTS (e.g. 24) and have both of us switch? `@types/node` is `^24`, which hints at 24. Decide one version and write it to `.nvmrc`; should we also add `engines` to `package.json`?
2. **Does `npm run build` pass without env vars?** `publicEnv()` throws when the Supabase vars are missing. If any route calls it during prerender (with `cacheComponents` on, static shells are rendered at build time), the build fails in CI. Need to verify by running a build with those vars unset. If it fails, the options are: (a) set dummy placeholder values in the workflow `env:` (not secrets, e.g. `https://example.supabase.co` and `placeholder`), or (b) change the code to defer reading. (a) fits the "no secrets" criterion and is the likely answer.
3. **Do the tests need any env?** Unit tests should mock everything per CLAUDE.md, but I haven't confirmed they pass with a clean environment. Run `npm run test` with the vars unset.
4. **Lint and typecheck cleanliness.** Do `npm run lint` and `npx tsc --noEmit` pass on `main` right now? If not, CI will be red on its first run and those fixes belong in a separate commit or issue.
5. **`.next` and `tsconfig.tsbuildinfo` in the working tree.** Confirm both are in `.gitignore` so CI caching decisions (e.g. caching `.next/cache`) don't depend on committed files.
6. **Caching.** Use `actions/setup-node` with `cache: npm` only, or also cache `.next/cache` for faster builds? Suggest npm cache only to start (simple).
7. **Step order and jobs.** One job running steps in sequence (matches the issue) vs. parallel jobs for lint/typecheck/test/build. Suggest one job at this project's size. Also add `concurrency` to cancel superseded runs on the same PR, and `permissions: contents: read`.
8. **Next telemetry and Turbopack.** Set `NEXT_TELEMETRY_DISABLED=1` in CI? Does `next build` (Turbopack by default in this version) work on `ubuntu-latest` with the `@tailwindcss/turbopack` loader? Windows-local vs Linux CI differences (path case, line endings) are possible; the first CI run will show.
9. **Action versions.** Pin `actions/checkout` and `actions/setup-node` to current major versions; confirm what is current before writing the file. Pin by SHA or by major tag?
10. **Proving it works.** The "test PR" criterion needs a pushed branch and a PR. CLAUDE.md says humans push, so Nakul pushes `feat/ci` and opens the PR.
11. **Branch protection.** Repo owner (Dhanraj) must enable "require status checks" after the first run, so the check name (job id/name) should be stable. Pick the job name before the first run, e.g. `ci`.
12. **E2E later.** Playwright is planned. Should this workflow leave room for a separate e2e job later? No action now.

## Proposed next step

Run lint, typecheck, test and build locally with the Supabase env vars unset to answer questions 2–4, then write `docs/plans/ci.md` before implementing.

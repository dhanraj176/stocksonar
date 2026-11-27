# Plan: GitHub Actions CI (#13)

Follows `docs/explore/ci.md`. Findings below come from running lint, tsc, test and build on a clean checkout of `HEAD` (no `.env*` files, fresh `npm ci`, Supabase vars unset).

## Decisions

- **Node 26.** Add `.nvmrc` containing `26` (both of us run Node 26 locally). The workflow uses `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`. `@types/node` stays as it is. No `engines` field.
- **One job named `ci`.** The name stays stable so branch protection can require it. Triggers: `pull_request` and `push` to `main`. Also `permissions: contents: read`, `concurrency` that cancels superseded runs, and `NEXT_TELEMETRY_DISABLED=1`.
- **Step order:** `npm ci`, `npm run lint`, `npm run test`, `npm run build`, `npx tsc --noEmit`.
  - **Build runs before tsc.** `LayoutProps` is a global that Next generates into `.next/types`. On a fresh checkout `tsc` fails with TS2304 until a build has run.
- **Placeholder env, not secrets.** Set on the job: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder`. The build passes without them today. They guard against a future static route calling `publicEnv()` (`lib/db/env.ts`), which throws when they are missing. No GitHub secrets.
- **Action versions.** Confirm the current major versions of `actions/checkout` and `actions/setup-node` before writing the file, and pin by major tag.

## Findings from the clean-checkout run

- `npm run lint`: passes.
- `npm run build`: passes with the Supabase vars unset (all 5 routes).
- `npx tsc --noEmit`: fails before a build (see above), passes after.
- `npm run test`: 344 of 345 pass. The failure is `lib/agents/report-provider.test.ts` "imports and returns a writer with no env set", which times out at 5s. Each test file's worker takes about 5s to start.
- `.next` and `tsconfig.tsbuildinfo` are gitignored.

## Known risk

The report-provider timeout is left alone on purpose. Dhanraj is fixing it separately. The PR description must say CI may fail on that one test until his fix merges.

## Out of scope

- Playwright e2e job, `.next/cache` caching, parallel jobs.
- Branch protection (the repo owner enables "require status checks" after the first run).
- Pushing and opening the PR (humans push).

## Implementation steps (next, after this plan is merged or approved)

1. Add `.nvmrc`.
2. Add `.github/workflows/ci.yml` as described above.
3. Human pushes `feat/ci` and opens a test PR to show the checks running.

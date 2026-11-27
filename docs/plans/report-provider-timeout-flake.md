# Plan: fix the report-provider.test.ts timeout flake (#27)

## Context

On Nakul's Windows machine, under the full parallel suite, 1 to 4 tests in `lib/agents/report-provider.test.ts` fail with 5 s timeouts. The file passes 15/15 on its own. `docs/plans/ci.md` saw the same failure on a clean checkout: "imports and returns a writer with no env set", the file's first test.

### Root cause

Every test calls `loadProvider()`, which runs `vi.resetModules()` and then dynamically imports `./report-provider` and `./report-writer-error`. That import happens inside the test, so it counts against the test's 5 s budget. It is expensive for two reasons:

1. **The first test does the first load.** The static imports at the top of the file load only `claude.ts`, `report-writer-error.ts` and the Anthropic SDK. The rest of the graph (`report-provider`, `gemini`, `openai-compat-writer`, `report-writer`, `report-pipeline`, `report-prompt`, `report-usage`, `lib/domain/citation-check`, `@anthropic-ai/sdk/helpers/zod`) is resolved and transformed for the first time inside test 1.
2. **Every later test reloads the graph through the main process.** `vi.resetModules()` (`node_modules/vitest/dist/chunks/utils.DYj33du9.js`) clears `evaluated` on every module the worker has loaded. After that, each `import()` makes one `resolveId` RPC to the main Vitest process, then one `fetchModule` RPC for each module in the graph (`node_modules/vite/dist/node/module-runner.js`, `getModuleInformation`). That happens even when the answer is "cached". A probe counted **14 modules re-evaluated per reset**: 10 local modules plus 3 `node_modules` entry points. 15 tests means about 200 sequential round trips, all queued behind the other 24 test files' traffic on the single main thread.

Measured on this Mac (10 cores):

| Run | First test | Later tests |
|---|---|---|
| File alone | 34 ms | ~1 ms |
| Full suite | 43 ms | ~1 ms |
| Full suite, CPU saturated (30 `yes` processes) | 95–221 ms | random spikes of 15–43 ms |

The spikes hit whichever tests' `loadProvider()` lands behind other workers' RPCs. That matches "1 to 4 tests, at random" on a slower machine, where Windows file-system and Defender overhead multiplies the cost. Nothing here is a real hang: no network (fetch is mocked to throw), no retries, no real timers in the code under test.

**Reproduction here:** `npx vitest run lib/agents/report-provider.test.ts --testTimeout=10` fails the same 2 tests on every run ("imports and returns a writer with no env set" and "sends the report to Gemini when REPORT_PROVIDER is unset"). These are the tests that pay for the first load.

## Decisions

- **Load the modules once per file, not once per test.** Replace `loadProvider()` with static imports of `getReportWriter`, `checkReportProvider` and `ReportWriterError` at the top of the file, and remove `vi.resetModules()`. The graph then loads during collection, which has no per-test timeout, and no test makes module RPCs.
- **The reset isn't needed.** Its comment says it exists so that "env is read fresh and the memoized Claude client starts empty". But:
  - env is already read on every call (`readProvider`, `getGeminiConfig`, `getAnthropicClient`). The "reads env on each call" test already proves this without a reset.
  - The memoized Claude client is keyed by API key and rebuilt when the key changes. Both Claude tests use the same key and the same `fetchMock` instance, and `beforeEach` stubs `fetch` before every test. Sharing the client is therefore harmless and doesn't depend on test order.
  - "Does not read env at import" is covered by `claude.test.ts`. The import here also runs with no env stubbed.
- **The assertions stay the same.** No `expect` changes, no tests added or removed, and the test names stay. Only how the modules are loaded changes. This is the fix itself, not editing a test to make it pass.
- **No production code changes.** `report-provider.ts` is correct.
- **Fallback, only if Windows still fails after the fix:** set a timeout in this file only (`vi.setConfig({ testTimeout: 15_000 })` at the top), with a comment linking to this plan and #27. Never change the global timeout.

## Out of scope

- `claude.test.ts` (7 resets, a 2-module graph), `report-writer.test.ts` (1 reset) and `gemini.test.ts` (1 reset). They reset on purpose to test import-time behaviour, their graphs are tiny, and they haven't been reported failing.
- Global Vitest config changes (pool, `maxWorkers`, `testTimeout`).
- The general cost of the first test in every file under heavy load. It shows up suite-wide at a 10 ms limit, but it is far below 5 s.

## Files

- `lib/agents/report-provider.test.ts`: static imports instead of `loadProvider()`, and no `vi.resetModules()`. Rewrite the header comment to say why the modules are loaded once.
- `docs/plans/report-provider-timeout-flake.md`: this plan.

## TDD cycles

This fix changes test code only, so there is no `test(red)` → `feat(green)` pair. A new failing test would assert on timing, which is the kind of flaky test we are removing. Instead:

1. **Red (reproduction, recorded in the PR, not committed):** run `npx vitest run lib/agents/report-provider.test.ts --testTimeout=10` 3 times. It fails 2/15 on every run.
2. **Green:** change the imports as described above. The same command passes 15/15, 3 runs in a row. Commit: `test: load report-provider once per file, not per test (#27)`.
3. **Refactor:** none expected.

## Verification

- The reproduction command passes 3 runs in a row, at the default timeout and at `--testTimeout=10`.
- `npm run test` (full suite) passes 3 runs in a row, and 3 more with the CPU saturated. Check that no module loads during a test. The first call down each writer path keeps a one-time warm-up (about 9 ms idle, from JIT and the first zod parse, with no module requests), so the later tests are the ones to compare against about 1 ms.
- `npm run lint`, `npx tsc --noEmit` and `npm run build` pass.
- Nakul runs `npm run test` 3 times in a row on Windows. This is the acceptance criterion that confirms the fix where the flake was seen. If it still fails, apply the fallback above.
- The PR description gives the root cause (the section above), the red/green output and the Windows result.

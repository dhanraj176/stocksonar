# Plan: report pipeline (#3)

## Context
Issue #3 needs a cited bull/bear report that is rejected, and never shown, when it fails the citation check. `validateReport` in `lib/domain/citation-check.ts` already enforces the citation rules. This slice adds the step that ties it together: fetch sources, ask a report agent for a report, parse the agent's untrusted output, check citations, and return either an accepted report or a rejection. The devil's-advocate section, the disclaimer, retries, the real EDGAR/news clients and the Anthropic SDK all come later. Findings behind this plan: `docs/explore/report-pipeline.md`.

## Files
- `lib/agents/report-pipeline.ts` (new): `generateReport`, its types, and a private zod schema
- `lib/agents/report-pipeline.test.ts` (new)
- `package.json` / `package-lock.json`: add `zod`
- Reused without changes: `validateReport`, `Report`, `FetchedSource` and `CitationError` from `lib/domain/citation-check.ts`

## Dependency: zod
`npm install zod@^4.6.7`, added under `dependencies` (it runs at request time, so it is not a dev dependency).
Why: CLAUDE.md requires zod for all external data at the boundary, and the agent's output is external data. zod 4.6.7 is already in `node_modules`, but only because `eslint-config-next` → `eslint-plugin-react-hooks` pulls it in. Importing a package you only get through a dev-tool dependency would break silently if that plugin drops or bumps it. Pinning the same major version means nothing new is downloaded. (`package.json` edits and `npm install` require approval under `.claude/settings.json`.)

## API
```ts
export type ReportPipelineDeps = {
  fetchSources: (ticker: string) => Promise<FetchedSource[]>;
  writeReport: (ticker: string, sources: FetchedSource[]) => Promise<unknown>; // untrusted
};

export type PipelineError =
  | { reason: "nothing-fetched" }
  | { reason: "malformed-report"; issues: string[] } // "bull.0.text: <zod message>"
  | CitationError;                                   // reused unchanged

export type PipelineResult =
  | { status: "ok"; report: Report }
  | { status: "rejected"; errors: PipelineError[] };

export async function generateReport(ticker: string, deps: ReportPipelineDeps): Promise<PipelineResult>
```
- `writeReport` returns `unknown`, so the compiler forces callers to parse it before using it.
- All errors share a `reason` field, so callers switch on one field. `"nothing-fetched"` is named so it can't be mistaken for the checker's per-claim `"no-sources"`.
- The `rejected` branch has no `report` field, so a rejected report can't be returned by mistake.

## Flow
1. `sources = await deps.fetchSources(ticker)`. If it is empty, return `{ status: "rejected", errors: [{ reason: "nothing-fetched" }] }` and do **not** call `writeReport`.
2. `raw = await deps.writeReport(ticker, sources)`.
3. `reportSchema.safeParse(raw)`. If it fails, return a rejection with `malformed-report` and the issues as `path: message` strings (`issue.path.map(String).join(".")`).
4. `validateReport(parsed, sources)`. If it is invalid, return `{ status: "rejected", errors: result.errors }`.
5. Otherwise return `{ status: "ok", report: parsed }` (the parsed value, not `raw`).

**Schema** (private, typed `z.ZodType<Report>` so it can't drift from the domain type):
`{ bull: Claim[], bear: Claim[] }`, where `Claim = { text: z.string().min(1), sourceIds: z.array(z.string()) }`.
- The schema checks only shape. Empty sections and empty `sourceIds` pass the schema on purpose, so `validateReport` can report them with the section and claim number.
- Non-empty `text` is the one rule I'm adding beyond shape: a blank claim isn't a claim.
- zod's default object parsing strips unknown keys, so stray fields from the agent never reach the result.

**Thrown errors:** if `fetchSources` or `writeReport` throws, the error propagates to the caller and is not turned into a rejection. Network failures are different from a bad report, and no retries happen yet.

## Tests (`lib/agents/report-pipeline.test.ts`)
Fixtures follow `citation-check.test.ts`: the same two SEC `sources`, a `validClaim`, and a `deps(overrides)` helper built on `vi.fn()` that resolves to the sources and a valid report. No network. Assertions check structured results only.

**Cycle 1: nothing fetched**
- returns `rejected` with `[{ reason: "nothing-fetched" }]` when `fetchSources` resolves to `[]`
- does not call `writeReport` when nothing was fetched

**Cycle 2: malformed agent output** (`it.each`, each case is `rejected` with one `malformed-report` error and non-empty `issues`)
- `null`, a string, and an array
- `bear` missing
- a claim whose `sourceIds` is a string, not an array
- a claim with empty `text`
- also: `issues` names the bad path (contains `"bull.0.text"` for the empty-text case)

**Cycle 3: citation failure**
- a report citing an unfetched id returns `rejected` with exactly `validateReport`'s errors (`{ section: "bear", claim: 1, reason: "unknown-source", sourceId: "src-made-up" }`)
- an empty `bull` section returns `rejected` with `{ section: "bull", claim: null, reason: "empty-section" }`
- a rejected result has no `report` property

**Cycle 4: accepted report**
- a valid report returns `{ status: "ok", report }` equal to the agent's report
- `fetchSources` is called with the ticker, and `writeReport` with the ticker and the fetched sources
- unknown keys from the agent (for example `recommendation: "BUY"`) are stripped from the returned report

**Errors from dependencies**
- a rejection from `fetchSources` makes `generateReport` reject with the same error
- a rejection from `writeReport` makes `generateReport` reject with the same error

## Execution order (later step)
1. `chore(deps): add zod for boundary validation (#3)`
2. For each cycle: `test(red): …` → `feat(green): …` → optional `refactor: …`, all suffixed `(#3)`
3. After each step: `npm run test` and `npm run lint`. Before each commit: `npx tsc --noEmit` and `npm run build`. Don't push.

## Verification
- `npx vitest run lib/agents/report-pipeline.test.ts`: the new tests pass
- `npm run test`: the 11 citation-check tests still pass
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: clean
- `git log` shows red/green pairs for each cycle, and `package.json` lists `zod` under `dependencies`

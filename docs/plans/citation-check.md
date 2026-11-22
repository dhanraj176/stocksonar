# Plan: citation checker (#3)

`lib/domain/citation-check.ts` exports `validateReport(report, fetchedSources)`, which returns `{ valid, errors }`.
It is pure: no network or database calls.

## Types
- `Claim = { text: string; sourceIds: string[] }`
- `Report = { bull: Claim[]; bear: Claim[] }`
- `FetchedSource = { id: string; url: string }`
- `CitationError = { section: "bull" | "bear"; claim: number | null; reason: "no-sources" | "unknown-source" | "empty-section"; sourceId?: string }`
  - `claim` is 1-based. It is `null` for section-level errors (an empty section has no claim to number).
  - `sourceId` is set only for `unknown-source`.
  - Errors are ordered bull first, then bear, then by claim order.

## Cycles (strict TDD, one per AC)
1. **AC1: claims cite fetched sources.** Test cases: a claim with no sources, a claim citing an unfetched id, a claim with one valid and one invalid id, and a claim with valid sources. Tests assert `valid` and the error `reason`s only.
2. **AC2: both sections are non-empty.** Test cases: empty bull, empty bear, both empty. Tests assert `valid` and the `reason`s.
3. **AC3: errors are specific.** Assert the full error objects (section, 1-based claim number or null, reason, sourceId) across both sections, and assert that a fully valid report returns `{ valid: true, errors: [] }`.

Each phase gets its own commit: `test(red)`, `feat(green)`, and `refactor` (optional). Nothing is pushed.

# Plan: EDGAR client (#14)

## Context
Issue #14 is the foundation that blocks #2 (sector from SIC code), #3 (cited reports) and #4 (thesis alerts). `lib/data/` doesn't exist yet. The report pipeline (`lib/agents/report-pipeline.ts`) already takes a `fetchSources: (ticker) => Promise<FetchedSource[]>` dependency, and `validateReport` (`lib/domain/citation-check.ts`) accepts a claim only if each cited id matches a `FetchedSource { id, url }` that was actually fetched. This slice builds the real EDGAR source: ticker → CIK, company profile, recent filings and Form 4 insider trades. It sends the SEC's required User-Agent, stays under the rate limit, validates every response with zod, and returns filings that are structurally `FetchedSource`s. The Supabase cache, the news API and wiring the client into `generateReport` come later.

## Files
| File | What |
|---|---|
| `lib/data/edgar.ts` (new) | `createEdgarClient(deps)` (main export), `getEdgarClient()` env factory, types, private zod schemas for the ticker map and submissions |
| `lib/data/sec-fetch.ts` (new) | `createSecFetcher`: User-Agent header, host allow-list, request spacing, non-2xx → `EdgarError` |
| `lib/data/form4.ts` (new) | `parseForm4(xml, source)`: XML → zod-validated `InsiderTrade[]` |
| `lib/data/memory-cache.ts` (new) | `Cache` interface + `createMemoryCache({ ttlMs, now })` |
| `lib/data/edgar-error.ts` (new) | `EdgarError` class |
| `lib/domain/money.ts` (new) | `dollarsToCents(decimal: string): number` (pure, strict TDD) |
| `*.test.ts` next to each | |
| `lib/data/fixtures/edgar/` (new) | saved SEC responses + `README.md` with the exact commands that made them, and the `SEC_USER_AGENT` documentation |
| `package.json` / lock | add `fast-xml-parser` |
| Reused unchanged | `FetchedSource`, `validateReport` from `lib/domain/citation-check.ts` (used in tests to show filings pass the checker) |

**Not on this branch:** `.env.example` and `.gitignore`. PR #17 (#11) already adds `.env.example` and the `!.env.example` exception, so touching them here would conflict when both merge. The client still reads `SEC_USER_AGENT` from the environment. `lib/data/fixtures/edgar/README.md` documents it (format: `StockSonar your-email@example.com`). The `SEC_USER_AGENT` line goes into `.env.example` in a follow-up after #17 merges (owner: Dhanraj). `.env*` files are never read.

## Dependency: fast-xml-parser
Form 4 is XML only. The SEC has no JSON endpoint for a single Form 4, and its insider data sets are quarterly bulk zips, so they're no use for "what changed overnight". Node has no built-in XML parser, and parsing with a regex is fragile against real filings. `fast-xml-parser` is pure JS, has zero dependencies, and is widely used. It doesn't resolve external entities (no XXE), which matters because filings are untrusted input. It goes under `dependencies`. Install the current 5.x release, checking that the version is at least two weeks old (`npm install` and `package.json` edits need approval).
Options: `ignoreAttributes: true`, `parseTagValue: false` (values stay strings, so CIKs keep leading zeros and numbers aren't parsed as floats), and `isArray` for `reportingOwner` and `nonDerivativeTransaction`. zod validates the parsed object.

## SEC endpoints
- Ticker map: `https://www.sec.gov/files/company_tickers.json` → `{ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, … }`
- Submissions: `https://data.sec.gov/submissions/CIK##########.json` → `name`, `sic`, `sicDescription`, `tickers`, and `filings.recent` as parallel column arrays (`accessionNumber[]`, `form[]`, `filingDate[]`, `reportDate[]`, `acceptanceDateTime[]`, `primaryDocument[]`, `primaryDocDescription[]`). This one response serves both the profile and the filings.
- Filing document: `https://www.sec.gov/Archives/edgar/data/{cik without zeros}/{accession without dashes}/{primaryDocument}`
- Form 4 `primaryDocument` looks like `xslF345X05/form4.xml`, which is the HTML render (the link users see). The raw XML is the same path with the `xsl…/` prefix removed.

## API (`lib/data/edgar.ts`)
```ts
export type EdgarClientDeps = {
  userAgent: string;               // "AppName contact@email"
  fetch?: typeof fetch;            // injected in tests
  cache?: Cache;                   // default: createMemoryCache({ ttlMs: 24h })
  now?: () => number; sleep?: (ms: number) => Promise<void>;  // for the rate limiter
};
export type CompanyProfile = { cik: string; name: string; sic: string | null; sicDescription: string | null; tickers: string[] };
export type Filing = FetchedSource & {   // assignable to FetchedSource as-is
  accessionNumber: string; form: string; filingDate: string; reportDate: string | null;
  acceptedAt: string; description: string | null;
};
export type InsiderTrade = {
  source: Filing;
  owners: { name: string; cik: string; isDirector: boolean; isOfficer: boolean; isTenPercentOwner: boolean; officerTitle: string | null }[];
  securityTitle: string; date: string;      // YYYY-MM-DD
  code: string;                              // P, S, A, M, F, G, …: alert rules decide what matters
  acquiredOrDisposed: "A" | "D";
  shares: number;                            // fractional allowed
  priceCents: number | null;                 // null when absent or footnote-only
  sharesOwnedAfter: number | null;
};
export function createEdgarClient(deps: EdgarClientDeps): {
  lookupCik(ticker: string): Promise<string | null>;   // 10-digit zero-padded; unknown → null
  getCompanyProfile(cik: string): Promise<CompanyProfile>;
  getRecentFilings(cik: string, opts: { forms: string[]; limit?: number }): Promise<Filing[]>;  // newest first, default 10
  getInsiderTrades(cik: string, opts?: { limit?: number }): Promise<InsiderTrade[]>;            // limit = Form 4 filings read, default 10
};
export function getEdgarClient(): ReturnType<typeof createEdgarClient>;  // reads SEC_USER_AGENT, memoized
```
- **Ticker normalization:** trim, uppercase, and `.` → `-` (the SEC writes `BRK-B`).
- **Source ids:** `edgar:{accessionNumber}`, for example `edgar:0000320193-24-000123`. They are stable and unique, so the same filing fetched twice gets the same id.
- **Dates:** `filingDate` and `reportDate` stay ISO dates (`YYYY-MM-DD`). `acceptedAt` is normalized to a UTC ISO timestamp. Empty strings become `null`.
- **Caching:** the ticker map is cached under `edgar:tickers` for 24h. Submissions are cached per CIK for 10 minutes, so `getCompanyProfile` and `getRecentFilings`/`getInsiderTrades` for the same company make one request between them. `Cache` is `{ get(key): Promise<unknown | undefined>; set(key, value, ttlMs): Promise<void> }`, async so a Supabase-backed version can implement it later without changing the client. Only parsed, validated data is cached.
- **Errors:** `EdgarError` with `kind: "http" | "invalid-response" | "config"` (plus `status` and `url` when set). A non-2xx response throws `http`. A zod failure throws `invalid-response` with the zod issues. There are no retries, which matches how the pipeline lets fetch errors propagate. An unknown ticker returns `null` and doesn't throw.

## User-Agent and rate limit (`lib/data/sec-fetch.ts`)
- Every request sends `User-Agent: <SEC_USER_AGENT>` and `Accept-Encoding: gzip, deflate` (fetch decompresses).
- `getEdgarClient()` validates `SEC_USER_AGENT` with zod (non-empty, contains an app name and an email-like token). If it's missing or malformed, it throws `EdgarError("config")` with a message that names `SEC_USER_AGENT` and its expected format. The check runs when the client is first used, not at import, so `npm run build` works without the env var.
- **Rate limit:** the SEC allows 10 req/s per client across all its hosts. One limiter is shared by every request from the process (`getEdgarClient` is memoized, so there's a single limiter). Requests are queued through a promise chain so they start at least 125 ms apart (8 req/s of headroom). It uses injected `now`/`sleep`, so tests don't need real timers.
- **Host allow-list:** the fetcher refuses any URL that isn't `https://www.sec.gov/` or `https://data.sec.gov/`. `primaryDocument` comes from SEC data, so it must also match `^[\w./-]+$` with no `..` before it's used in a path.
- **Known limit:** each serverless instance has its own limiter. That's acceptable for v1 because caching keeps traffic low. Revisit once there's a shared Supabase cache.

## Form 4: the minimum the stories need
Stories #3, #4 and #5 need to say "who traded, what, when, how much, at what price, and what they hold now", with a link. So `parseForm4` reads:
- `issuer.issuerCik` (checked against the requested CIK: a mismatch is `invalid-response`)
- each `reportingOwner`: name, CIK, and the director/officer/10%-owner flags with officer title (`"1"`/`"true"` → `true`)
- each `nonDerivativeTable.nonDerivativeTransaction`: security title, transaction date, code, shares, price per share (→ `dollarsToCents`, rounding half-up when there are more than 2 decimals), A/D, and shares owned after

**Left out, on purpose:**
- the derivative table (options, RSUs, warrants, exercise and conversion terms)
- footnotes. A price given only as a footnote becomes `priceCents: null`. Footnote text is also untrusted free text we don't need.
- `nonDerivativeHolding` rows (holdings with no transaction)
- Forms 3, 5 and amendments (`4/A`). An amendment could correct an original, so this is a known gap.
- the 10b5-1 plan checkbox, direct/indirect ownership and its nature, deemed execution date, remarks and signatures
- filings older than the submissions `recent` window (the paged `filings.files` list)
- XBRL financials (`companyfacts`), which aren't in this issue

## Fixtures: how we get realistic ones
These are real SEC responses, saved once by hand and trimmed. They live in `lib/data/fixtures/edgar/`, and `README.md` there records the exact `curl` + `jq` commands and the date fetched, so anyone can regenerate them. The commands send `-H "User-Agent: $SEC_USER_AGENT"` from the developer's own shell. The email is in the header only, never in a saved file. SEC data is public, so the fixtures contain no secrets.
- `company-tickers.json`: the real file filtered with `jq 'with_entries(select(.value.ticker | IN("AAPL","MSFT","BRK-B")))'`. That keeps the real shape (object keyed by index strings, numeric `cik_str`) and stays small.
- `submissions-aapl.json`: `CIK0000320193.json` with every `filings.recent` column cut to the same window of rows, chosen so it includes at least one 10-K, 10-Q, 8-K and two Form 4s. `filings.files` is emptied. The jq command slices every column with the same indices so the arrays stay aligned.
- `form4-sale.xml` and `form4-award.xml`: the raw XML of two Form 4s **listed in that submissions fixture**, so the fixtures agree with each other. One has an open-market sale (`S`). The other has an award, exercise or tax-withholding transaction and a derivative table, which proves we ignore that table. These are kept whole and unedited. (These two are XML, not JSON, because that's what the SEC serves.)
- Failure cases (wrong types, mismatched column lengths, missing fields, a price given only as a footnote, an issuer-CIK mismatch) are built **in the tests** by changing a loaded fixture, so the files on disk stay real.
- To keep the network out of tests, each test injects a `fakeFetch(routes)` that serves fixtures by URL, records calls, and throws on any unknown URL. `vi.stubGlobal("fetch", …)` also makes the global throw. Fixtures are read with `readFileSync`, which is local disk only.

## Tests and TDD cycles
Each cycle is a `test(red): …` → `feat(green): …` → optional `refactor: …` sequence, suffixed `(#14)`.
1. **`dollarsToCents`:** `"172.5"` → 17250, `"0.0001"` → 0, `"172.345"` → 17235 (half-up), `"10"` → 1000. Rejects `""`, `"-1"`, `"1e3"` and `"abc"`. No floats are used.
2. **Memory cache:** returns the value before the TTL and `undefined` after it (injected `now`), and keys don't collide.
3. **SEC fetcher:**
   - sends the exact User-Agent
   - rejects non-SEC hosts without calling fetch
   - three back-to-back requests produce sleeps that keep starts at least 125 ms apart
   - a non-2xx response throws `EdgarError` `http` with the status
4. **`lookupCik`:**
   - AAPL → `"0000320193"`; `" brk.b "` → BRK-B's CIK
   - an unknown ticker → `null`
   - two lookups mean one fetch (cached); after the TTL, it fetches again
   - a malformed map → `invalid-response`
5. **`getCompanyProfile`:** name, `sic` and `sicDescription` come from the fixture. An empty `sic` → `null`. A wrong type → `invalid-response`.
6. **`getRecentFilings`:**
   - filters by form, newest first, respects `limit`
   - builds the id and URL as specified
   - mismatched column lengths → `invalid-response`
   - **the returned filings passed to `validateReport` accept a report that cites their ids**
   - profile + filings for the same CIK make one request
7. **`parseForm4`:**
   - the sale fixture gives the expected trades (owner, flags, code `S`, shares, `priceCents`, owned-after)
   - the award fixture ignores derivative rows
   - a footnote-only price → `null`
   - an issuer mismatch or a missing transaction date → `invalid-response`
8. **`getInsiderTrades`:**
   - fetches only `form === "4"` filings, up to `limit`
   - requests the raw XML path (no `xsl…/`), and the trade's `source.url` is the human-readable path
   - every `trade.source` passes `validateReport`
9. **`getEdgarClient`:** `vi.stubEnv` with no or a malformed `SEC_USER_AGENT` → `EdgarError("config")`, and a valid value → a client.

## Execution order (later session)
1. `chore(deps): add fast-xml-parser for Form 4 XML (#14)`
2. `test(fixtures): add trimmed SEC EDGAR fixtures (#14)`, fetched with the README commands (needs network and the developer's `SEC_USER_AGENT`). The README also documents the env var.
3. Cycles 1–9 as red/green pairs
4. After each step: `npm run test` and `npm run lint`. Before each commit: `npx tsc --noEmit` and `npm run build`. Don't push.

## Verification
- `npx vitest run lib/data lib/domain/money.test.ts` passes, and `npm run test` still passes the existing citation-check and report-pipeline tests
- with Wi-Fi off, the whole suite still passes (no network)
- `npm run lint`, `npx tsc --noEmit` and `npm run build` are clean with `SEC_USER_AGENT` unset
- manual smoke test (optional, real network): a one-off `node` script calls `getEdgarClient().lookupCik("AAPL")` and `getInsiderTrades`, and each `source.url` opens the filing on sec.gov

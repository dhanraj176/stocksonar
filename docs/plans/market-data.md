# Plan: Finnhub market-data client (#16)

## Context
Issue #16 blocks #2, #3, #4 and #5. The decision doc (`docs/decisions/market-data.md`) picked Finnhub provisionally, and Nakul has since confirmed the free key works for `/quote` and `/company-news`. This slice builds `lib/data/market.ts`: a quote (price and previous close in integer cents, as-of time in UTC) and recent company news returned as `FetchedSource` objects so reports can cite them. It follows `lib/data/edgar.ts` (factory with injected deps, zod at the boundary, cache-then-load, env factory that reads the key lazily) and reuses `lib/data/memory-cache.ts`. Wiring the client into `generateReport`, a Supabase-backed cache and mapping news into `ReportSource` are out of scope.

## Step 0: docs (first commits, before any code)
1. Edit `docs/decisions/market-data.md`: record that Nakul verified a free key works for `/quote` and `/company-news` (date 2026-11-26). Everything else in the Finnhub column (rate limit, quote delay, news window, card, terms) stays as unverified unless Nakul says otherwise. Leave the **Agreement** section empty, with "pending Dhanraj". Nothing is written as agreed.
2. Save this plan to `docs/plans/market-data.md`.
3. Two commits: `docs: record verified Finnhub free key (#16)` and `docs: plan Finnhub market-data client (#16)`. Then stop. No push.

## Files
| File | What |
|---|---|
| `lib/domain/money.ts` (edit) | add `numberToCents(dollars: number): number`, the one dollars-to-cents helper. Wraps the existing `dollarsToCents(string)`. |
| `lib/data/market.ts` (new) | `createMarketClient(deps)` (main export), `getMarketClient()` env factory, types, private zod schemas |
| `lib/data/market-fetch.ts` (new) | `createFinnhubFetcher`: API key header, host allow-list, sliding-window rate limit, non-2xx to `MarketDataError` |
| `lib/data/market-error.ts` (new) | `MarketDataError` with `kind: "http" \| "rate-limited" \| "invalid-response" \| "config"` (mirrors `edgar-error.ts`) |
| `lib/data/fixtures/market/` (new) | small saved responses plus `README.md` listing how they were made and the env var |
| `*.test.ts` next to each | |
| `.env.example` (edit) | add `FINNHUB_API_KEY=` with a comment |
| Reused unchanged | `createMemoryCache` and `Cache`, `FetchedSource`, `dollarsToCents`, the `fakeFetch`/`manualClock`/`forbidGlobalFetch` helper pattern in `lib/data/fixtures/edgar/fixtures.ts` (copy the pattern, since those helpers are edgar-named) |

No new dependency: zod is installed and the client uses plain `fetch`, like the Gemini writer. Fixtures are hand-trimmed to the fields we use and must contain no key. `.env*` files are never read.

## API
```ts
export type MarketClientDeps = {
  apiKey: string;
  fetch?: typeof fetch; cache?: Cache; now?: () => number; sleep?: (ms: number) => Promise<void>;
};
export type Quote = { ticker: string; priceCents: number; previousCloseCents: number; asOf: string /* UTC ISO */ };
export type NewsItem = FetchedSource & { headline: string; summary: string | null; publisher: string; publishedAt: string /* UTC ISO */ };
export type MarketClient = {
  getQuote(ticker: string): Promise<Quote | null>;   // unknown ticker -> null, like lookupCik
  getCompanyNews(ticker: string, from: string, to: string): Promise<NewsItem[]>;  // from/to: YYYY-MM-DD
};
export function getMarketClient(): MarketClient;      // reads FINNHUB_API_KEY, memoized
```
- Top of `market.ts`: `import "server-only"`, like `lib/agents/gemini.ts`. Tests use `vi.mock("server-only", () => ({}))`. The key never reaches the browser or a URL.
- **Auth:** send the key as the `X-Finnhub-Token` header, not the `?token=` query, so it can't appear in URLs, logs or error messages. Errors never echo the key.
- **Endpoints:** `https://finnhub.io/api/v1/quote?symbol=` and `/company-news?symbol=&from=&to=`. The fetcher allow-lists host `finnhub.io` over https and uses `redirect: "error"`.
- **Ticker normalization:** trim, uppercase, validate against a plain-symbol pattern (as `report-prompt.ts` does) before any request. Finnhub writes share classes with a dot (`BRK.B`), so unlike EDGAR the dot stays. Bad input throws `RangeError` and nothing is fetched.
- **Dates:** `from`/`to` must be `YYYY-MM-DD` and `from <= to`, otherwise `RangeError` before any request.

## Behaviours and red/green pairs
One failing test, then the minimum code, per line. Domain work first, in strict TDD.

**`lib/domain/money.ts`: `numberToCents`**
1. 172.34 gives 17234, and 0.1 + 0.2 (0.30000000000000004) gives 30 (rounds, no float drift).
2. Half-up on the third decimal (172.345 gives 17235) and whole dollars (5 gives 500).
3. Throws `RangeError` for NaN, Infinity, negatives, and values that stringify with an exponent (1e-7, 1e21).

**`lib/data/market-error.ts` and `market-fetch.ts`**
4. Sends `X-Finnhub-Token`, never puts the key in the URL, and never includes it in an error message.
5. Refuses any URL that isn't https `finnhub.io`.
6. Non-2xx gives `MarketDataError("http")` with status and URL (no key); 429 gives `"rate-limited"`.
7. A non-JSON body gives `"invalid-response"`.
8. Rate limit: a sliding window of 50 requests per 60 seconds (headroom under Finnhub's 60/min free limit and its 30/s cap). Requests 1-50 start immediately, the 51st waits (via injected `sleep`) until the oldest slot is 60s old, and concurrent callers queue in call order. Uses the injected `now`/`sleep`, so no real timers.

**`getQuote`**
9. Parses `{c, pc, t, ...}`: `priceCents`, `previousCloseCents` via `numberToCents`, `asOf` from `t` (Unix seconds) as a UTC ISO string.
10. Unknown ticker returns `null`. Real Finnhub returns `{c:0,d:null,dp:null,h:0,l:0,o:0,pc:0,t:0}`, so the check is that `c, h, l, o, pc, t` are all 0, and `d`/`dp` are ignored (they come back null).
11. zod: a missing or non-numeric `c`/`pc`/`t`, or a negative price, throws `invalid-response` with the issues. A partly zero quote (for example `c: 0` but `pc > 0`) is `invalid-response`, not `null`.
12. Normalizes the ticker (` aapl ` and `AAPL` are one request and one cache entry); an invalid ticker throws before any fetch.
13. Cache: `market:quote:{TICKER}` for 60 seconds. A second call within a minute makes no request; after it, it refetches. `null` results are cached too (60s), so a typo can't be hammered. Cached values are re-validated on read, as `edgar.ts` does.

**`getCompanyNews`**
14. Maps each item to a `NewsItem`: `id: "finnhub:news:{id}"` (stable per Finnhub article id), `url`, `headline`, `summary`, `publisher` (Finnhub's `source`), `publishedAt` from `datetime` (Unix seconds) as UTC ISO.
15. Sorted newest first, ties broken by id.
16. Dedupe: drop repeats by article id and by URL (syndicated copies), keeping the newest.
17. Cap at 20 after dedupe and sort.
18. Untrusted text: headline and summary are trimmed, control characters removed and length-capped (headline 300, summary 1,000 code points, cut by code point like `report-prompt.ts`). They are kept as plain data and never interpreted, and `buildReportPrompt` escapes them when they reach a prompt. A fixture with an item whose headline says "Ignore previous instructions..." proves it comes through as inert text.
19. URLs must parse as `http:` or `https:` (no `javascript:`, `data:`, or credentials). An item that fails validation is dropped on its own; a response that isn't an array at all, or an item missing `id`/`url`/`headline`/`datetime`, throws `invalid-response` only for the non-array case. (Decision: dropping bad items keeps one malformed article from blocking a report. The tests make both cases explicit.)
20. Empty array gives `[]`.
21. Citation: every returned item passes `validateReport` as a cited source (a report citing `finnhub:news:{id}` is accepted, a made-up id is rejected).
22. Cache: `market:news:{TICKER}:{from}:{to}` for 10 minutes. Re-validated on read.
23. `to` in the past (a closed range) can use the same TTL. Not worth special-casing.

**`getMarketClient`**
24. Missing or blank `FINNHUB_API_KEY` throws `MarketDataError("config")` with a clear message that doesn't echo the value. Same client instance is reused (so one rate limiter per process) and rebuilt if the key changes. It isn't read at import, so builds need no env.

## Rate limiting and cache together
Cache hits don't count against the limit. The limiter is per process (each serverless instance has its own, as noted in `sec-fetch.ts`). With 60s/10min TTLs that stays far below 60 calls a minute for a normal portfolio. When Supabase caching replaces the memory cache later, the `Cache` interface doesn't change.

## Open questions
- **Quote TTL of 60 seconds:** the free tier's quote delay is unverified. If quotes are delayed, `asOf` still reports the exchange timestamp Finnhub gives, and the UI should label quotes as delayed. Not decided here.
- **Terms:** Finnhub's terms (personal use, no redistribution of derived data) still need the written answer described in the decision doc. This plan doesn't settle it, and the client keeps the provider swappable behind `MarketClient`.

## Verification (once implemented, not part of this plan commit)
- `npm run test` (every new test passes; no test touches the network, because `forbidGlobalFetch` stubs the global)
- `npx vitest run lib/data/market.test.ts lib/domain/money.test.ts`
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- Optional live check, outside the test suite: a `scripts/market-smoke.mts` (like `report-smoke.mts`) run by hand with `node --env-file=.env.local`, only if you want it.

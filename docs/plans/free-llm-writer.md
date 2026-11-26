# Plan: free LLM provider for reports, OpenAI-compatible writer (#21)

## Context
The report writer from #15 (`lib/agents/report-writer.ts`) calls Claude, and every report costs money. To run at $0 we switch the default to Gemini, paid from Google's developer credits, through its OpenAI-compatible endpoint. The Claude writer stays as an option.

This slice:
- adds an OpenAI-compatible writer and a `REPORT_PROVIDER` switch
- shrinks the prompt and output (insider trades summarized in code, claim caps, a prompt-size budget test)
- logs tokens and latency
- turns quota errors into `ReportWriterError("quota")` so the app can fall back to a cached report

**Branch:** `feat/free-llm-writer` is stacked on `feat/claude-report-writer` (PR #20, draft). The PR will target `feat/claude-report-writer`, not `main`.

**Decisions made with Dhanraj:**
- Claim caps: `reportSchema` gets `.max(5)` per side, which becomes `maxItems: 5` in the JSON schema for both providers, and the pipeline rejects a 6th claim as `malformed-report`. The under-40-words rule is in the prompt only.
- Insider trades are summarized **per Form 4**. Each filing stays one citable source, and its content becomes one code-computed summary instead of a line per trade.
- The default model is `gemini-3.8-flash`, overridable with `GEMINI_MODEL`. *(Changed to `gemini-3.5-flash-lite` after the live runs; see Implementation notes.)*

**Out of scope:**
- `.env.example` (PR #17 owns it; the lines are added after it merges)
- retries and backoff
- the cached-report fallback itself (app side, #3)
- the real `fetchSources` (#3)
- the devil's-advocate agent and any UI

## What Gemini's docs say (read 2026-11-25; the pages now live at aistudio.google.com/docs/…)
- **Base URL:** `https://generativelanguage.googleapis.com/v1beta/openai/`. The endpoint is `POST …/chat/completions` with `Authorization: Bearer <key>`. Support for the OpenAI libraries is marked "beta".
- **Structured output:** supported through `response_format`. The docs show it only through the OpenAI SDK helper `zodResponseFormat`, which sends `{ type: "json_schema", json_schema: { name, schema, strict: true } }`. We send that shape directly.
  - Schema support: `maxItems`/`minItems` are enforced. `minLength`/`maxLength` are stripped, not enforced. Every output field should be `required`.
- **Reasoning:**
  - It can't be turned off on Gemini 3 and 4.
  - `reasoning_effort` accepts `minimal | low | medium | high`. The mapping table doesn't list 3.8 Flash, so the smoke run confirms that `minimal` is accepted.
  - `temperature` is ignored on 3.6+ and triggers deprecation headers (a future 400), so we never send it.
- **Rate limits:**
  - Limits apply per project, not per key, and requests-per-day resets at midnight Pacific.
  - Free-tier numbers for Flash are only on the live AI Studio page (`aistudio.google.com/rate-limit`). Dhanraj checks them there.
- **Errors:**
  - `429 RESOURCE_EXHAUSTED` means a rate or quota limit was hit.
  - `402` means "Prepay credit balance is depleted".
  - No `Retry-After` header is documented.
  - The OpenAI-compatible error body isn't documented (Google's errors come as `{error:{…}}` and sometimes `[{error:{…}}]`), so the writer decides by HTTP status only and reads the body just for a short message.
- **Not documented:** the exact `usage` fields and the `finish_reason` values. The response is parsed with a tolerant zod schema, and the smoke run confirms what really comes back.
- **Model notes:** `gemini-2.5-flash` routes to 3.5 Flash-Lite from 2026-12-01, so we don't use it.

## No new dependency
The writer uses plain `fetch`, injected the same way as `lib/data/sec-fetch.ts`, and validates the response with zod. The `openai` SDK would bring retries we don't want (quota errors should fall back right away, not burn more of the per-minute limit) and a second LLM SDK, for what is one POST request.

## Files
| File | What |
|---|---|
| `lib/agents/report-prompt.ts` (new) | **Moved from `report-writer.ts`, behavior unchanged:** `SYSTEM_PROMPT`, `normalizeTicker`, `sourceBlock`, `cap`, `escapeXml` and the 4,000/200 caps. Main export: `buildReportPrompt(ticker, sources) → { system, user }`, which throws `invalid-input` for a bad ticker. Also exports `ReportSource`, `PROMPT_BUDGET_CHARS` and `MAX_CLAIMS_PER_SIDE = 5`. |
| `lib/agents/report-writer.ts` | The Claude writer now uses `buildReportPrompt`. `getReportWriter` is renamed to `getClaudeReportWriter`. A 429 (`Anthropic.RateLimitError`) becomes `quota`, and usage is logged. |
| `lib/agents/openai-compat-writer.ts` (new) | `createOpenAiCompatWriter({ baseUrl, apiKey, model, fetch?, now?, log? })` |
| `lib/agents/gemini.ts` (new, `server-only`) | `GEMINI_DEFAULT_MODEL = "gemini-3.8-flash"`, the default base URL, and `getGeminiConfig()`. It reads `GEMINI_API_KEY`, `GEMINI_MODEL` and `GEMINI_BASE_URL` on call, never at import. |
| `lib/agents/report-provider.ts` (new, `server-only`) | `getReportWriter()`, the one the app uses. It reads `REPORT_PROVIDER` on call and returns the Gemini or Claude writer. |
| `lib/agents/report-usage.ts` (new) | The `ReportUsage` type and `logReportUsage` (default `console.info` of one JSON line) |
| `lib/agents/report-writer-error.ts` | Adds kinds `quota` and `api`, plus an optional `status` |
| `lib/agents/report-pipeline.ts` | `reportSchema`: `bull`/`bear` get `.max(5)` |
| `lib/domain/insider-summary.ts` (new) | `summarizeInsiderTrades(trades)`, pure and built with TDD |
| `lib/agents/insider-sources.ts` (new) | `insiderTradeSources(trades): ReportSource[]`: one source per Form 4, with summary text |
| `scripts/report-smoke.mts` | Uses `report-provider`, `insiderTradeSources` and `--env-file` |
| `CLAUDE.md` | Names Gemini (OpenAI-compatible) as the default report provider, with Claude optional |
| Tests | Next to each module: `*.test.ts` |
| Reused unchanged | `generateReport`, `validateReport`, `dollarsToCents`, `InsiderTrade`, `getEdgarClient`, `register-ts-hooks.mjs` |

## Env (all read on call, server-only, values never echoed)
| Var | Default | Notes |
|---|---|---|
| `REPORT_PROVIDER` | `gemini` when unset or blank | `gemini` or `claude`. Anything else throws `config`. |
| `GEMINI_API_KEY` | — | Required when the provider is gemini. Missing → `config`. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` (was `gemini-3.8-flash`; see Implementation notes) | |
| `GEMINI_BASE_URL` | Google's OpenAI-compatible URL | Must be `https:`, or it throws `config` |
| `ANTHROPIC_API_KEY` | — | Required only when the provider is claude, same as #15 |

Switching providers needs only env changes. `GEMINI_API_KEY` and `REPORT_PROVIDER` go into `.env.example` after #17 merges (see memory: PR #17 owns that file).

## OpenAI-compatible writer
**Request:** `POST {baseUrl}/chat/completions`. The join handles a trailing slash.
- `Authorization: Bearer <key>`
- `signal: AbortSignal.timeout(60_000)`
- Body:
  ```json
  { "model": "...",
    "messages": [{"role":"system","content":system},{"role":"user","content":user}],
    "response_format": {"type":"json_schema","json_schema":{"name":"report","strict":true,"schema": REPORT_JSON_SCHEMA}},
    "max_tokens": 2048,
    "reasoning_effort": "minimal" }
  ```
- `REPORT_JSON_SCHEMA` = `z.toJSONSchema(reportSchema)` with `$schema` removed, computed once. The pipeline's schema stays the only validator.
- There's no `temperature`.
- `max_tokens` 2048 leaves headroom over the roughly 600–900 tokens that 10 claims of under 40 words need, plus minimal reasoning. The smoke run's usage log tells us whether to tune it.
- Claude keeps `max_tokens: 16000`, because its adaptive thinking shares that budget. The claim caps bound Claude's visible output.

**Response:** validated by a tolerant zod schema:
```
{ choices: [{ message: { content: string|null, refusal?: string|null },
              finish_reason: string|null }],
  usage?: { prompt_tokens, completion_tokens,
            completion_tokens_details?: { reasoning_tokens? } } }
```
- `finish_reason: "length"` → `truncated`
- `"content_filter"`, or a non-empty `message.refusal` → `refusal` (category `"content_filter"` or null)
- otherwise, `JSON.parse(content)`; raw text if it isn't JSON; `undefined` if there's no content. The pipeline turns either of the last two into `malformed-report`, the same as Claude.
- A body that fails the schema → `api` ("unexpected response shape")

**Errors:**
- HTTP `429` or `402` → `ReportWriterError("quota", …, { status })`
- Any other non-2xx → `api` with `status`
- The message includes at most 200 characters of the provider's error message, with control characters stripped. It never includes the key or the prompt.
- A network or abort error propagates unchanged.
- No retries.

**Usage log** (both writers, on success and on failure): one line through the injected `log`:
```
{ event:"report-usage", provider, model, inputTokens, outputTokens, reasoningTokens, latencyMs, outcome }
```
- `outcome` is `ok` or the error kind.
- Latency comes from the injected `now`.
- The prompt, the sources and the key are never logged.

## Prompt changes (in `report-prompt.ts`)
- **New rules:** at most 5 claims per side, each under 40 words.
- **Budget:** `PROMPT_BUDGET_CHARS` (system + user) is set from the measured size of a realistic fixture, rounded up with about 25% headroom:
  - the 5 filings' metadata
  - 5 Form 4 summaries
  - one 10-K excerpt at the 4,000-character cap

  A test builds the prompt for that fixture and fails if it goes over the budget. A second test caps the system prompt on its own.

## Insider summary (`lib/domain/insider-summary.ts`, strict TDD)
- **Input** is a structural type defined in `lib/domain`, so the domain never imports `lib/data`. `InsiderTrade` satisfies it.
  `{ owners: {cik, name, officerTitle}[], code, acquiredOrDisposed, shares, priceCents, date }`
- **Output:**
  ```
  { tradeCount, insiderCount, insiders, netShares, acquiredShares, disposedShares,
    totalValueCents, unpricedTradeCount, codeCounts, firstDate, lastDate }
  ```
  - `insiderCount`: distinct owner CIKs
  - `totalValueCents`: the sum of `Math.round(shares × priceCents)` over priced trades. Code G (gifts) and trades without a price don't count; they add to `unpricedTradeCount`. An unsafe integer throws `RangeError`.
  - Share sums are rounded to 4 decimal places, so fractional shares don't leave float noise.
  - `codeCounts` is kept so the model can tell open-market sales (S) from tax withholding (F) or exercises (M).
- **`insiderTradeSources(trades)`** (`lib/agents/insider-sources.ts`) groups trades by `source.id`. Each Form 4 gives one `ReportSource` (its id and URL, title `Form 4 filed <date>`), whose content is one formatted summary, for example:
  `3 trades by 1 insider (Jane Doe, CFO), 2026-10-01 to 2026-10-02. Net shares: -50,000 (acquired 0, disposed 50,000). Value of priced trades: $11,500,000.00; 1 unpriced. Codes: S×2, F×1.`
  - The dollar formatting uses integer cents only.

## TDD cycles (each one a `test(red)` → `feat(green)` pair, `(#21)`)
**Tests:**
- Tests mock `fetch` and the Claude client and never touch the network.
- `server-only` is mocked with `vi.mock`, and env with `vi.stubEnv`.
- Assertions are on the requests, structured results and logs, never on generated text.
- The existing tests in `report-writer.test.ts` keep their assertions. The only change is the import rename in step 1, and that change is in a `refactor:` commit.

**Commits:**
1. `refactor:` move prompt building to `report-prompt.ts`, and rename `getReportWriter` to `getClaudeReportWriter`. All existing tests stay green.
2. `summarizeInsiderTrades`:
   - net, acquired and disposed shares
   - value in cents, with gifts and unpriced trades excluded
   - distinct insiders by CIK
   - code counts and the date range
   - fractional shares
   - an empty list
3. `insiderTradeSources`:
   - one source per Form 4
   - the summary text
   - escaping is left to the prompt builder
4. Claim caps:
   - the prompt states 5 claims and 40 words
   - the pipeline rejects 6 claims as `malformed-report`
   - the JSON schema has `maxItems: 5`, for both writers
5. Prompt budget: a `test:` commit (it may pass on arrival). It is seen failing with the budget lowered.
6. OpenAI-compatible request:
   - URL join and auth header
   - system and user messages built by `buildReportPrompt`
   - `response_format` json_schema strict
   - `max_tokens` and `reasoning_effort`
   - no `temperature`
   - a timeout signal
   - a bad ticker → `invalid-input`, and fetch is never called
7. OpenAI-compatible results:
   - the JSON is returned
   - prose goes to `malformed-report` (through the real `generateReport`)
   - `length` → `truncated`
   - `content_filter` or a refusal → `refusal`
   - a bad shape → `api`
   - the prompt-injection test runs end to end, mirroring #15's
8. HTTP errors:
   - 429 and 402 → `quota` with `status`
   - 500 → `api`
   - both error body shapes (`{error}` and `[{error}]`)
   - the message is capped and never contains the key
9. Usage logging:
   - token counts on success, for both writers
   - latency from a fake `now`
   - `outcome` on failure
   - the prompt and key never appear in the log
10. Claude: `Anthropic.RateLimitError` → `quota`. The existing "API errors propagate unchanged" test, which uses a plain `Error`, stays green.
11. Config:
   - `REPORT_PROVIDER` unset → Gemini; `claude` → Claude; a bad value → `config`
   - a missing `GEMINI_API_KEY` → `config`, naming the variable without echoing the value
   - `GEMINI_MODEL` and `GEMINI_BASE_URL` overrides, and a non-https base URL → `config`
   - importing with no env set doesn't throw

**Then:**
- `chore: run the report smoke script on the chosen provider (#21)`:
  - `node --env-file=.env.local scripts/report-smoke.mts [TICKER]`
  - prints the provider, the model and the usage line
  - uses `insiderTradeSources` in place of its own `tradeSources`
  - fails fast on missing config before any SEC request
- `docs: name Gemini as the report provider (#21)` updates CLAUDE.md (tech stack and status lines).

**Before each commit:** `npm run test`, `npm run lint`, `npx tsc --noEmit` and `npm run build`, all with no API keys set. The untracked `supabase/` directory isn't ours and is never staged. Don't push.

## Verification
- `npx vitest run lib/agents lib/domain` passes, and `npm run test` passes the full suite.
- The suite passes with outbound network blocked (`sandbox-exec … deny network-outbound`).
- `npm run lint`, `npx tsc --noEmit` and `npm run build` are clean with no keys set.
- The smoke script, with env unset, prints a `config` error before any network call.
- Dhanraj runs `node --env-file=.env.local scripts/report-smoke.mts AAPL` with `REPORT_PROVIDER` unset (Gemini), then with `claude`, and checks:
  - the status is `ok` and every cited id is a fetched filing
  - at most 5 claims per side, each short
  - no buy or sell language
  - the usage line shows the tokens and latency
  - Gemini accepts `json_schema` strict and `reasoning_effort: "minimal"` for 3.8 Flash. If it returns a 400 for either, drop that field and note it in "Implementation notes".
- Exhausting the quota isn't forced live; the tests cover 429 and 402.

## Execution order for this session
1. Copy this plan to `docs/plans/free-llm-writer.md`.
2. Commit it with `docs: add free LLM writer plan (#21)`, staging only that file.
3. Stop. No implementation and no push.

## Implementation notes (2026-11-25)
Built as planned in TDD pairs, with these differences:

- **Claude gets no real `maxItems`.** Claude's structured output doesn't support `maxItems`, so the SDK's `zodOutputFormat` moves it into the property description (`"{maxItems: 5}"`). The model still sees the cap, and the pipeline's `reportSchema` enforces it for both providers. Gemini gets real `maxItems: 5`. The red test that assumed `maxItems` for Claude was corrected in its own `test:` commit before green.
- **`checkReportProvider()`** (in `report-provider.ts`, not in the plan) names the provider and model, or throws `config`, without sending anything. The smoke script uses it to fail fast and to print the provider.
- **`trackUsage()`** in `report-usage.ts` wraps one model call in either writer and logs once, on success or failure. Nothing is logged when no request was sent (a bad ticker, missing config).
- **`ReportWriterError`** gained `quota` and `api` kinds, an optional `status`, and an optional `cause` (the SDK's `RateLimitError` for Claude).
- **Prompt budget:** the realistic fixture measures 9,296 characters, 835 of them the system prompt. `PROMPT_BUDGET_CHARS` is 12,000 and `SYSTEM_PROMPT_BUDGET_CHARS` is 1,100.
- **The provider's error message** has the key redacted, as well as being capped and stripped of control characters.

**Verification:**
- 280 tests pass, including with outbound network denied (`sandbox-exec … (deny network-outbound (remote ip))`). lint, tsc and build are clean with no keys set.
- With no keys set, the smoke script stops with a `config` error before any SEC request, for `gemini`, `claude` and an unknown provider.
- **Live Gemini run: pending.** `.env.local` has no `SEC_USER_AGENT`, so the run stopped at the EDGAR config check before any request. Once it's set, run `node --env-file=.env.local scripts/report-smoke.mts AAPL` and check the list under Verification, especially whether Gemini accepts `json_schema` strict and `reasoning_effort: "minimal"`.
- **Live Claude run: skipped.** There's no Anthropic API key.

**Live Gemini run, first attempt (2026-11-25):**
- The API key works.
- Gemini returned HTTP 400: "Thinking level MINIMAL is not supported for this model. Please retry with other thinking level." `reasoning_effort: "minimal"` isn't accepted by `gemini-3.8-flash`.
- The writer now sends `reasoning_effort: "low"`. That keeps reasoning cheap; dropping the field would leave the model at its default thinking level. The test was changed first and seen failing.
- `max_tokens` stays 2048. Re-run the smoke script and check the usage line's `reasoningTokens`; if low reasoning makes answers hit `truncated`, raise `max_tokens`.
- Strict `json_schema` hasn't been confirmed yet, because the 400 came first.

**Live Gemini runs, after the switch to `"low"` (2026-11-25, run by Dhanraj):**
- **`gemini-3.5-flash-lite`: passed.**
  - Status ok: 2,139 input and 371 output tokens, 1.9 s.
  - Every citation is a fetched filing, and there's no buy or sell language.
  - Strict `json_schema` and `reasoning_effort: "low"` were both accepted.
- **`gemini-3.8-flash`: failed on the free tier.** It returned HTTP 503 (high demand) twice, and once timed out at 60 s.
- **What changed:**
  - `GEMINI_DEFAULT_MODEL` is now `gemini-3.5-flash-lite`, and `GEMINI_MODEL` still overrides it.
  - HTTP 503 becomes a new `ReportWriterError("unavailable")` with the status, kept apart from `api`. Like `quota`, the app falls back to a cached report and doesn't retry.
  - Tests were changed first and seen failing.
- **Re-run on the committed default** (Claude Code, AAPL):
  - Status ok: 2,139 input and 400 output tokens, `reasoningTokens` null (Gemini didn't report it), 2.2 s.
  - The 2 bull and 2 bear claims each cite fetched filings.
- **Still open:**
  - The bull claims are thin, because the filing sources carry only metadata (form, dates, description). Real filing excerpts come with #3.
- **Timeouts (follow-up):** the 60 s timeout is now `unavailable` too, whether it fires during `fetch` or while the answer is still arriving. The original `TimeoutError` is kept as `cause`, and the outcome is logged as `unavailable`. Other aborts and network errors still propagate unchanged. Tests came first.

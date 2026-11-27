# Decision: market-data and news provider (#16)

Status: **proposed, not yet agreed.** The issue requires both of us to agree on one provider. Record the agreement at the bottom.

Research date: 2026-11-26. Items marked **UNVERIFIED** could not be confirmed from an official page (JS-rendered pages returned no content, or the page was a PDF we could not read). Third-party summaries are noted as such. Check each UNVERIFIED item by hand on the provider's site before we build `lib/data/market.ts`.

## What we need

- A quote for a ticker: price (we store integer cents) and an as-of time. Delayed or end-of-day is acceptable. We are a research tool, not a trading tool.
- Recent news items per ticker, with URL, headline, source and publish time, to wrap as `FetchedSource` objects for citations.
- A free key, with terms that allow displaying the data in our app. No scraping (CLAUDE.md).
- Volume is small: caching in Supabase means one call per ticker per refresh, not per page view.

## Candidates

| | Finnhub | Massive (formerly Polygon.io) | Alpha Vantage |
|---|---|---|---|
| Free-tier limit | 60 calls/min (Finnhub pricing page, via search snippet; the page itself did not render). Terms add a 30 calls/second cap on all plans (official terms). | 5 calls/min (third-party summaries and search snippet of massive.com pricing; **UNVERIFIED** in the official page text) | 25 requests/day (official support page). Per-minute cap not stated on pages we read. |
| Quote delay | Sources conflict: some say real-time US quotes on free, none confirm delayed. **UNVERIFIED.** | End of day on the free plan (third-party). **UNVERIFIED** officially. Real-time is paid ("Stocks Advanced", $199/month, individual use only). | `GLOBAL_QUOTE` is end of day for free users. Real-time and 15-minute delayed data are premium (official docs and support page). |
| Company news on free tier | Yes, about 1 year of history (third-party; **UNVERIFIED** officially) | Yes: the news docs say "Included in all Stocks plans", Basic gets 2 years of history, "Updated hourly" (official docs). `GET /v2/reference/news`, with ticker filter. | No: `NEWS_SENTIMENT` is marked "this is a premium API function" (official docs). |
| Credit card needed | **UNVERIFIED** (believed no) | **UNVERIFIED** (believed no) | Not stated on the signup page (form asks for an email). Not verified. |
| Terms and our use | Terms of service (official, read in full): all plans are "strictly for personal use unless explicitly stated otherwise". A personal plan is not available to anyone using the data "for your business or registering under your business name". No redistribution of "data or derived results" to any third party without written approval. All data must be deleted when the subscription ends. Display in an app, caching and scraping are not addressed. | Two sets of terms: Individuals ("personal, individual, and non-business use") and Businesses. The sub-pages were not read, so display, caching, redistribution and scraping are **UNVERIFIED.** | Free key implies agreement to the Terms of Service (official). "Commercial use: contact sales" (docs). The terms PDF could not be read, so everything else is **UNVERIFIED.** |
| Fit | Best free coverage on paper. Terms risk (below). | Good news endpoint and a clean API. Free quotes are end of day only. 5/min is tight but fine with caching. | Fails on news (premium). 25/day is too low for even a small portfolio. |

## Terms risk (applies to Finnhub and Massive)

Both providers restrict free or individual plans to personal, non-business use. Finnhub's wording is the stricter one, and it forbids sharing "derived results" with third parties. StockSonar shows data to other users (and to investment clubs), which could count as redistribution. For a course project with no revenue this may be tolerable, but we should not assume so. Options:

1. Email Finnhub (and Massive) and ask whether displaying cached quotes and headlines to our app's logged-in users on a free key is allowed. Get the answer in writing.
2. Keep the data layer behind `lib/data/market.ts` so the provider can be swapped without touching agents or UI. We want this regardless.
3. Show only what citations need: headline, URL, source name and time, with links out to the original article, instead of republishing article bodies.

## Recommendation

**Provisional pick: Finnhub**, because the free tier is the only one that clearly covers both a quote and ticker news with a usable rate limit (60/min). **Fallback: Massive Basic** (end-of-day quotes, 2 years of news, 5/min). **Reject: Alpha Vantage** (news is premium, 25 requests/day).

This is provisional because the evidence for Finnhub's free-tier details is mostly third-party. Before we agree:

- [ ] Log in to Finnhub and confirm the free plan's rate limit, quote latency, company-news window and whether a card was asked for.
- [ ] Read Finnhub's and Massive's terms on display and caching, and email them if unclear (see above).
- [ ] If Finnhub's terms rule out our use, switch to Massive Basic after the same check on its Individuals terms.
- [ ] Note that the quote's as-of time must come from the API response, and the UI must label quotes as delayed.

## Verified by hand

2026-11-26, Nakul: a free Finnhub key works for `/quote` and `/company-news`. The other Finnhub items above (rate limit, quote delay, news window, card, terms) are still unverified.

## Agreement

Pending Dhanraj. Not yet agreed. When Dhanraj and Nakul agree, add: provider chosen, date, and any terms answers received.

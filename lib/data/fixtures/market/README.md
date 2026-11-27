# Finnhub fixtures

Small hand-trimmed responses shaped like Finnhub's `/quote` and `/company-news` output, used by
`lib/data/market*.test.ts`. They hold no API key and no real article text. Tests never touch the
network.

- `quote-aapl.json`: a normal quote. `t` is Unix seconds.
- `quote-unknown.json`: what Finnhub returns for an unknown symbol (all zeros, `d`/`dp` null).

To check a shape against the live API, run by hand with your own key (never commit the output
without trimming it):

    curl -H "X-Finnhub-Token: $FINNHUB_API_KEY" "https://finnhub.io/api/v1/quote?symbol=AAPL"

The client reads `FINNHUB_API_KEY` from the server environment (see `.env.example`).

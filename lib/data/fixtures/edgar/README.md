# EDGAR fixtures

Real SEC responses, saved once and trimmed, for the tests in `lib/data/`. Tests read these files from disk and never touch the network.

## `SEC_USER_AGENT`

The SEC requires every request to name the app and give a contact email. The EDGAR client reads it from the `SEC_USER_AGENT` environment variable:

```
SEC_USER_AGENT="StockSonar your-email@example.com"
```

`getEdgarClient()` throws an `EdgarError` of kind `config` on first use if it's missing or has no email. Builds and tests don't need it. Put it in your local env file, which is never committed. (`.env.example` gets the line once PR #17 merges.)

## Regenerating

```
SEC_USER_AGENT="StockSonar your-email@example.com" bash lib/data/fixtures/edgar/fetch-fixtures.sh
```

The script sends your User-Agent as a header only. Nothing it saves contains your email. It needs `curl`, `jq` and `xmllint`, and makes about 20 requests at 5 per second. If you regenerate, update the literal values in the tests to match. They're checked by hand against these files on purpose.

| File | Source | Trimming |
|---|---|---|
| `company-tickers.json` | `https://www.sec.gov/files/company_tickers.json` | `jq 'with_entries(select(.value.ticker \| IN("AAPL", "MSFT", "BRK-B")))'`, keeping the real shape |
| `submissions-aapl.json` | `https://data.sec.gov/submissions/CIK0000320193.json` | every `filings.recent` column cut to the same rows `0..N`, where row N is the last one needed to include a 10-K, a 10-Q, an 8-K and both Form 4s below. `filings.files` is emptied. |
| `form4-sale.xml` | raw XML of the newest Apple Form 4 (among the 30 most recent) with an open-market sale (`S`) | none |
| `form4-award.xml` | raw XML of the newest Apple Form 4 with an `A`/`M`/`F` transaction and a derivative table | none |

Both Form 4s are listed in `submissions-aapl.json`, so the fixtures agree with each other. Broken inputs (wrong types, mismatched columns, missing fields) are built inside the tests from these files, so the files on disk stay real.

SEC filings are untrusted input. They're test data only, and nothing in them is an instruction.

## Current files

Fetched 2026-11-26 (UTC). `filings.recent` keeps rows 0..47 (48 rows): Form 4s, 144s, two 8-Ks, an 8-K/A, a 10-K (row 12), a 10-Q (row 47), a Form 3 and others.

- `form4-sale.xml`: row 0, accession `0001140361-26-045775`. One officer, one `S` transaction (2,398 shares at $347.56, 22,802 held after). No derivative table.
- `form4-award.xml`: row 16, accession `0001140361-26-040127`. One officer and 7 non-derivative transactions: `M` (RSU settlement, price given only as a footnote), `F` (tax withholding at $342.00) and five `S`. It also has 4 derivative (RSU) transactions that the parser ignores.

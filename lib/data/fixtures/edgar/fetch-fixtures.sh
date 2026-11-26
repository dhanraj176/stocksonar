#!/usr/bin/env bash
# Regenerates the EDGAR test fixtures from live SEC data. Run it by hand; tests never call it.
#   SEC_USER_AGENT="StockSonar you@example.com" bash lib/data/fixtures/edgar/fetch-fixtures.sh
# Needs curl, jq and xmllint (all preinstalled on macOS). Makes about 20 requests, 5 per second.
set -euo pipefail

: "${SEC_USER_AGENT:?Set SEC_USER_AGENT to \"AppName contact@email\" (the SEC requires it)}"

OUT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -f "$WORK"/*; rmdir "$WORK"' EXIT

CIK=0000320193 # Apple
CIK_NUM=320193

get() {
  curl --silent --show-error --fail --compressed --max-redirs 0 \
    -H "User-Agent: $SEC_USER_AGENT" "$1" -o "$2"
  sleep 0.2
}

# 1. Ticker map, filtered to three tickers but keeping the real shape.
get "https://www.sec.gov/files/company_tickers.json" "$WORK/tickers.json"
jq 'with_entries(select(.value.ticker | IN("AAPL", "MSFT", "BRK-B")))' "$WORK/tickers.json" \
  > "$OUT/company-tickers.json"

# 2. Apple's submissions. Find a recent open-market sale and a recent award/exercise Form 4.
get "https://data.sec.gov/submissions/CIK$CIK.json" "$WORK/submissions.json"

sale_row=""
award_row=""
for row in $(jq -r '.filings.recent.form | to_entries | map(select(.value == "4")) | .[0:30] | .[].key' "$WORK/submissions.json"); do
  accession=$(jq -r ".filings.recent.accessionNumber[$row]" "$WORK/submissions.json")
  document=$(jq -r ".filings.recent.primaryDocument[$row]" "$WORK/submissions.json")
  raw_document="${document#xsl*/}"
  get "https://www.sec.gov/Archives/edgar/data/$CIK_NUM/${accession//-/}/$raw_document" "$WORK/$row.xml"

  sales=$(xmllint --nonet --xpath 'count(//nonDerivativeTransaction[transactionCoding/transactionCode="S"])' "$WORK/$row.xml")
  awards=$(xmllint --nonet --xpath 'count(//nonDerivativeTransaction[transactionCoding/transactionCode="A" or transactionCoding/transactionCode="M" or transactionCoding/transactionCode="F"])' "$WORK/$row.xml")
  derivatives=$(xmllint --nonet --xpath 'count(//derivativeTransaction)' "$WORK/$row.xml")

  if [ -z "$sale_row" ] && [ "$sales" -gt 0 ]; then
    sale_row=$row
    cp "$WORK/$row.xml" "$OUT/form4-sale.xml"
  elif [ -z "$award_row" ] && [ "$awards" -gt 0 ] && [ "$derivatives" -gt 0 ]; then
    award_row=$row
    cp "$WORK/$row.xml" "$OUT/form4-award.xml"
  fi
  if [ -n "$sale_row" ] && [ -n "$award_row" ]; then break; fi
done

if [ -z "$sale_row" ] || [ -z "$award_row" ]; then
  echo "Did not find both a sale and an award Form 4 in the 30 most recent; widen the search." >&2
  exit 1
fi

# 3. Trim every filings.recent column to the same window: newest row through the last row we need.
end=$(jq --argjson sale "$sale_row" --argjson award "$award_row" '
  .filings.recent.form as $f
  | [
      ($f | index("10-K")), ($f | index("10-Q")), ($f | index("8-K")),
      $sale, $award
    ]
  | if any(. == null) then error("a required form is missing from filings.recent") else max end
' "$WORK/submissions.json")

jq --argjson end "$end" '
  .filings.recent |= with_entries(.value |= .[0:($end + 1)])
  | .filings.files = []
' "$WORK/submissions.json" > "$OUT/submissions-aapl.json"

echo "Fetched $(date -u +%Y-%m-%d). Kept rows 0..$end of filings.recent."
echo "form4-sale.xml:  row $sale_row, accession $(jq -r ".filings.recent.accessionNumber[$sale_row]" "$WORK/submissions.json")"
echo "form4-award.xml: row $award_row, accession $(jq -r ".filings.recent.accessionNumber[$award_row]" "$WORK/submissions.json")"

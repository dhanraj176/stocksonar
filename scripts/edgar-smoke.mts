/**
 * Live smoke test for the EDGAR client. Hits the real SEC (about 6 requests), so it is NOT part of
 * `npm run test` (Vitest only picks up *.test.ts). Run by hand:
 *
 *   SEC_USER_AGENT="StockSonar you@example.com" node scripts/edgar-smoke.mts [TICKER]
 *
 * Uses Node's built-in TypeScript support, so no extra dependencies (see register-ts-hooks.mjs).
 */
import "./register-ts-hooks.mjs";

const { getEdgarClient } = await import("../lib/data/edgar");
const { EdgarError } = await import("../lib/data/edgar-error");

/** SEC text is untrusted: strip control characters so it can't send escape codes to the terminal. */
function clean(value: string | null): string {
  return value === null ? "-" : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function dollars(cents: number | null): string {
  return cents === null ? "-" : `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const ticker = process.argv[2] ?? "AAPL";

try {
  const edgar = getEdgarClient();

  const cik = await edgar.lookupCik(ticker);
  console.log(`\n${ticker} -> CIK ${cik ?? "not found"}`);
  if (cik === null) process.exit(1);

  const profile = await edgar.getCompanyProfile(cik);
  console.log("\nCompany profile");
  console.log(`  name:      ${clean(profile.name)}`);
  console.log(`  SIC:       ${clean(profile.sic)} (${clean(profile.sicDescription)})`);
  console.log(`  tickers:   ${profile.tickers.map(clean).join(", ")}`);

  const filings = await edgar.getRecentFilings(cik, { forms: ["10-K", "10-Q", "8-K"], limit: 3 });
  console.log("\n3 most recent 10-K / 10-Q / 8-K filings");
  for (const filing of filings) {
    console.log(`  ${filing.filingDate}  ${clean(filing.form).padEnd(5)} ${filing.id}`);
    console.log(`              ${filing.url}`);
  }

  const trades = await edgar.getInsiderTrades(cik, { limit: 3 });
  console.log(`\nInsider trades from the 3 latest Form 4 filings (${trades.length} transactions)`);
  for (const trade of trades) {
    const owners = trade.owners
      .map((owner) => `${clean(owner.name)}${owner.officerTitle ? ` (${clean(owner.officerTitle)})` : ""}`)
      .join("; ");
    console.log(
      `  ${trade.date}  ${trade.code}/${trade.acquiredOrDisposed}  ${trade.shares} sh @ ${dollars(trade.priceCents)}` +
        `  -> ${trade.sharesOwnedAfter ?? "-"} held  ${owners}`,
    );
    console.log(`              ${trade.source.url}`);
  }
  console.log();
} catch (error) {
  if (error instanceof EdgarError) {
    console.error(`\nEdgarError (${error.kind})${error.status ? ` HTTP ${error.status}` : ""}: ${error.message}`);
    for (const issue of error.issues ?? []) console.error(`  - ${issue}`);
    process.exit(1);
  }
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message || error.cause.name})` : "";
  console.error(`\nRequest failed: ${error instanceof Error ? error.message : String(error)}${cause}`);
  process.exit(1);
}

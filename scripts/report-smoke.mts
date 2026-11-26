/**
 * Live smoke test for the report writer: EDGAR -> Claude -> the report pipeline, for one ticker.
 * Hits the real SEC (about 8 requests) and makes ONE Claude call, which costs money, so it is NOT
 * part of `npm run test` (Vitest only picks up *.test.ts). Run by hand:
 *
 *   SEC_USER_AGENT="StockSonar you@example.com" ANTHROPIC_API_KEY=sk-ant-... node scripts/report-smoke.mts [TICKER]
 *
 * Uses Node's built-in TypeScript support, so no extra dependencies (see register-ts-hooks.mjs).
 */
import "./register-ts-hooks.mjs";

const { getEdgarClient } = await import("../lib/data/edgar");
const { EdgarError } = await import("../lib/data/edgar-error");
const { generateReport } = await import("../lib/agents/report-pipeline");
const { getAnthropicClient } = await import("../lib/agents/claude");
const { getClaudeReportWriter } = await import("../lib/agents/report-writer");
const { ReportWriterError } = await import("../lib/agents/report-writer-error");

type InsiderTrade = import("../lib/data/edgar").InsiderTrade;
type ReportSource = import("../lib/agents/report-writer").ReportSource;

/** SEC data and model output are untrusted: strip control characters so they can't send escape codes. */
function clean(value: string | null): string {
  return value === null ? "-" : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function dollars(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** One readable line per trade. A gift (code G) is filed at $0, which is not a price. */
function describeTrade(trade: InsiderTrade): string {
  const owners = trade.owners
    .map((owner) => `${owner.name}${owner.officerTitle ? ` (${owner.officerTitle})` : ""}`)
    .join("; ");
  const direction = trade.acquiredOrDisposed === "A" ? "acquired" : "disposed of";
  const price = trade.code === "G" || trade.priceCents === null ? "no price" : `at ${dollars(trade.priceCents)}`;
  const held = trade.sharesOwnedAfter === null ? "" : `, ${trade.sharesOwnedAfter} shares held after`;
  return `${trade.date}: ${owners} ${direction} ${trade.shares} shares of ${trade.securityTitle} (code ${trade.code}), ${price}${held}.`;
}

/** One source per Form 4, so each filing is cited once however many trades it lists. */
function tradeSources(trades: InsiderTrade[]): ReportSource[] {
  const byFiling = new Map<string, { source: InsiderTrade["source"]; lines: string[] }>();
  for (const trade of trades) {
    const entry = byFiling.get(trade.source.id) ?? { source: trade.source, lines: [] };
    entry.lines.push(describeTrade(trade));
    byFiling.set(trade.source.id, entry);
  }
  return [...byFiling.values()].map(({ source, lines }) => ({
    id: source.id,
    url: source.url,
    title: `Form 4 filed ${source.filingDate}`,
    content: lines.join("\n"),
  }));
}

const ticker = process.argv[2] ?? "AAPL";

try {
  const edgar = getEdgarClient();
  getAnthropicClient(); // Fails fast on a missing key, before any SEC requests.
  const writeReport = getClaudeReportWriter();

  const cik = await edgar.lookupCik(ticker);
  console.log(`\n${clean(ticker)} -> CIK ${cik ?? "not found"}`);
  if (cik === null) process.exit(1);

  const filings = await edgar.getRecentFilings(cik, { forms: ["10-K", "10-Q", "8-K"], limit: 5 });
  const trades = await edgar.getInsiderTrades(cik, { limit: 5 });
  const sources: ReportSource[] = [
    ...filings.map((filing) => ({
      id: filing.id,
      url: filing.url,
      title: `${filing.form} filed ${filing.filingDate}`,
      content: [
        `Form ${filing.form}, filed ${filing.filingDate}, accepted ${filing.acceptedAt}.`,
        filing.reportDate ? `Period of report: ${filing.reportDate}.` : null,
        filing.description ? `Description: ${filing.description}.` : null,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    })),
    ...tradeSources(trades),
  ];
  console.log(`${sources.length} sources: ${filings.length} filings, ${sources.length - filings.length} Form 4s`);

  const urlById = new Map(sources.map((source) => [source.id, source.url]));
  console.log("Asking Claude for the report (one call)...");
  const result = await generateReport(ticker, { fetchSources: async () => sources, writeReport });

  if (result.status === "rejected") {
    console.log("\nStatus: rejected");
    for (const error of result.errors) console.log(`  - ${clean(JSON.stringify(error))}`);
    process.exit(1);
  }

  console.log("\nStatus: ok");
  for (const [label, claims] of [
    ["Bull case", result.report.bull],
    ["Bear case", result.report.bear],
  ] as const) {
    console.log(`\n${label}`);
    claims.forEach((claim, index) => {
      console.log(`  ${index + 1}. ${clean(claim.text)}`);
      for (const id of claim.sourceIds) console.log(`       [${clean(id)}] ${urlById.get(id) ?? "-"}`);
    });
  }
  console.log();
} catch (error) {
  if (error instanceof EdgarError) {
    console.error(`\nEdgarError (${error.kind})${error.status ? ` HTTP ${error.status}` : ""}: ${error.message}`);
    for (const issue of error.issues ?? []) console.error(`  - ${issue}`);
    process.exit(1);
  }
  if (error instanceof ReportWriterError) {
    console.error(`\nReportWriterError (${error.kind}): ${error.message}`);
    process.exit(1);
  }
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message || error.cause.name})` : "";
  console.error(`\nRequest failed: ${error instanceof Error ? clean(error.message) : String(error)}${cause}`);
  process.exit(1);
}

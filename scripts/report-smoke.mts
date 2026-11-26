/**
 * Live smoke test for the report writer: EDGAR -> the chosen provider -> the report pipeline, for
 * one ticker. Hits the real SEC (about 8 requests) and makes ONE model call (Gemini spends free
 * quota or developer credits; Claude costs money), so it is NOT part of `npm run test` (Vitest only
 * picks up *.test.ts). Run by hand:
 *
 *   node --env-file=.env.local scripts/report-smoke.mts [TICKER]
 *
 * .env.local needs SEC_USER_AGENT and GEMINI_API_KEY (the default provider), or REPORT_PROVIDER=claude
 * and ANTHROPIC_API_KEY. GEMINI_MODEL and GEMINI_BASE_URL are optional. The writer logs one
 * report-usage JSON line with tokens and latency.
 *
 * Uses Node's built-in TypeScript support, so no extra dependencies (see register-ts-hooks.mjs).
 */
import "./register-ts-hooks.mjs";

const { getEdgarClient } = await import("../lib/data/edgar");
const { EdgarError } = await import("../lib/data/edgar-error");
const { generateReport } = await import("../lib/agents/report-pipeline");
const { checkReportProvider, getReportWriter } = await import("../lib/agents/report-provider");
const { insiderTradeSources } = await import("../lib/agents/insider-sources");
const { ReportWriterError } = await import("../lib/agents/report-writer-error");

type ReportSource = import("../lib/agents/report-prompt").ReportSource;

/** SEC data and model output are untrusted: strip control characters so they can't send escape codes. */
function clean(value: string | null): string {
  return value === null ? "-" : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

const ticker = process.argv[2] ?? "AAPL";

try {
  const edgar = getEdgarClient();
  const { provider, model } = checkReportProvider(); // Fails fast on missing config, before any SEC requests.
  const writeReport = getReportWriter();
  console.log(`Provider: ${provider} (${clean(model)})`);

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
    ...insiderTradeSources(trades),
  ];
  console.log(`${sources.length} sources: ${filings.length} filings, ${sources.length - filings.length} Form 4s`);

  const urlById = new Map(sources.map((source) => [source.id, source.url]));
  console.log(`Asking ${provider} for the report (one call)...`);
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
    const status = error.status ? ` HTTP ${error.status}` : "";
    console.error(`\nReportWriterError (${error.kind})${status}: ${clean(error.message)}`);
    process.exit(1);
  }
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message || error.cause.name})` : "";
  console.error(`\nRequest failed: ${error instanceof Error ? clean(error.message) : String(error)}${cause}`);
  process.exit(1);
}

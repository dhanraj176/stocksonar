import type { InsiderTrade } from "@/lib/data/edgar";
import { summarizeInsiderTrades, type InsiderSummary } from "@/lib/domain/insider-summary";
import type { ReportSource } from "./report-prompt";

/**
 * One report source per Form 4, so each filing is cited once however many trades it lists.
 * The content is a code-computed summary, which keeps the prompt small. Text stays raw:
 * buildReportPrompt escapes it.
 */
export function insiderTradeSources(trades: InsiderTrade[]): ReportSource[] {
  const byFiling = new Map<string, { source: InsiderTrade["source"]; trades: InsiderTrade[] }>();
  for (const trade of trades) {
    const entry = byFiling.get(trade.source.id) ?? { source: trade.source, trades: [] };
    entry.trades.push(trade);
    byFiling.set(trade.source.id, entry);
  }
  return [...byFiling.values()].map(({ source, trades: filed }) => ({
    id: source.id,
    url: source.url,
    title: `Form 4 filed ${source.filingDate}`,
    content: describe(summarizeInsiderTrades(filed)),
  }));
}

function describe(summary: InsiderSummary): string {
  const insiders = summary.insiders
    .map((insider) => (insider.officerTitle ? `${insider.name}, ${insider.officerTitle}` : insider.name))
    .join("; ");
  const dates = summary.firstDate === summary.lastDate ? `on ${summary.firstDate}` : `${summary.firstDate} to ${summary.lastDate}`;
  const net = `${summary.netShares > 0 ? "+" : ""}${shares(summary.netShares)}`;
  const unpriced = summary.unpricedTradeCount > 0 ? `; ${summary.unpricedTradeCount} unpriced` : "";
  const codes = Object.entries(summary.codeCounts)
    .map(([code, count]) => `${code}×${count}`)
    .join(", ");

  return [
    `${plural(summary.tradeCount, "trade")} by ${plural(summary.insiderCount, "insider")} (${insiders}), ${dates}.`,
    `Net shares: ${net} (acquired ${shares(summary.acquiredShares)}, disposed ${shares(summary.disposedShares)}).`,
    `Value of priced trades: ${dollars(summary.totalValueCents)}${unpriced}.`,
    `Codes: ${codes}.`,
  ].join(" ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function shares(count: number): string {
  return count.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** From integer cents, without float math. */
function dollars(cents: number): string {
  const whole = (cents - (cents % 100)) / 100;
  return `$${whole.toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

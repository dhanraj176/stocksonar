/** The parts of a Form 4 trade the summary reads. lib/data's InsiderTrade satisfies it. */
export type InsiderTradeInput = {
  owners: { cik: string; name: string; officerTitle: string | null }[];
  /** SEC transaction code (P, S, A, M, F, G, ...). */
  code: string;
  acquiredOrDisposed: "A" | "D";
  /** Can be fractional. */
  shares: number;
  priceCents: number | null;
  /** YYYY-MM-DD */
  date: string;
};

export type InsiderSummary = {
  tradeCount: number;
  insiderCount: number;
  insiders: { cik: string; name: string; officerTitle: string | null }[];
  netShares: number;
  acquiredShares: number;
  disposedShares: number;
  totalValueCents: number;
  unpricedTradeCount: number;
  codeCounts: Record<string, number>;
  firstDate: string | null;
  lastDate: string | null;
};

export function summarizeInsiderTrades(trades: InsiderTradeInput[]): InsiderSummary {
  void trades;
  throw new Error("not implemented");
}

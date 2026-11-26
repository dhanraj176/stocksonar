/** The parts of a Form 4 trade the summary reads. lib/data's InsiderTrade satisfies it. */
export type InsiderTradeInput = {
  owners: Insider[];
  /** SEC transaction code (P, S, A, M, F, G, ...). */
  code: string;
  acquiredOrDisposed: "A" | "D";
  /** Can be fractional. */
  shares: number;
  priceCents: number | null;
  /** YYYY-MM-DD */
  date: string;
};

export type Insider = { cik: string; name: string; officerTitle: string | null };

export type InsiderSummary = {
  tradeCount: number;
  /** Distinct reporting owners, by CIK. */
  insiderCount: number;
  /** In order of first appearance. */
  insiders: Insider[];
  netShares: number;
  acquiredShares: number;
  disposedShares: number;
  /** Sum of shares x price over priced trades, each rounded to the cent. */
  totalValueCents: number;
  /** Trades with no price, and gifts (code G), which are filed at $0. Not in totalValueCents. */
  unpricedTradeCount: number;
  codeCounts: Record<string, number>;
  firstDate: string | null;
  lastDate: string | null;
};

/** Share sums keep 4 decimal places, enough for fractional shares without float noise. */
const SHARE_DECIMALS = 1e4;

/**
 * Totals for a list of insider trades, computed in code so the model reads one line
 * instead of every trade. Throws RangeError if the value can't be held exactly in cents.
 */
export function summarizeInsiderTrades(trades: InsiderTradeInput[]): InsiderSummary {
  const insiders = new Map<string, Insider>();
  const codeCounts: Record<string, number> = {};
  let acquired = 0;
  let disposed = 0;
  let totalValueCents = 0;
  let unpricedTradeCount = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  for (const trade of trades) {
    for (const owner of trade.owners) {
      if (!insiders.has(owner.cik)) insiders.set(owner.cik, owner);
    }
    codeCounts[trade.code] = (codeCounts[trade.code] ?? 0) + 1;

    if (trade.acquiredOrDisposed === "A") acquired += trade.shares;
    else disposed += trade.shares;

    if (trade.code === "G" || trade.priceCents === null) {
      unpricedTradeCount += 1;
    } else {
      totalValueCents += Math.round(trade.shares * trade.priceCents);
      if (!Number.isSafeInteger(totalValueCents)) {
        throw new RangeError("Insider trade value is too large to hold exactly in cents.");
      }
    }

    if (firstDate === null || trade.date < firstDate) firstDate = trade.date;
    if (lastDate === null || trade.date > lastDate) lastDate = trade.date;
  }

  return {
    tradeCount: trades.length,
    insiderCount: insiders.size,
    insiders: [...insiders.values()],
    netShares: roundShares(acquired - disposed),
    acquiredShares: roundShares(acquired),
    disposedShares: roundShares(disposed),
    totalValueCents,
    unpricedTradeCount,
    codeCounts,
    firstDate,
    lastDate,
  };
}

/** Adding 0 turns -0 into 0. */
function roundShares(shares: number): number {
  return Math.round(shares * SHARE_DECIMALS) / SHARE_DECIMALS + 0;
}

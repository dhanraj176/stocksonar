import type { Filing } from "./edgar";

export type InsiderOwner = {
  name: string;
  cik: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  officerTitle: string | null;
};

export type InsiderTrade = {
  /** The Form 4 this trade came from, citable by id. */
  source: Filing;
  owners: InsiderOwner[];
  securityTitle: string;
  /** YYYY-MM-DD */
  date: string;
  /** SEC transaction code (P, S, A, M, F, G, ...). Alert rules decide which ones matter. */
  code: string;
  acquiredOrDisposed: "A" | "D";
  /** Can be fractional. */
  shares: number;
  /** null when the filing gives no price, or gives it only in a footnote. */
  priceCents: number | null;
  sharesOwnedAfter: number | null;
};

export function parseForm4(xml: string, context: { source: Filing; issuerCik: string }): InsiderTrade[] {
  throw new Error(`parseForm4 is not implemented (${xml.length} chars, ${context.source.id})`);
}

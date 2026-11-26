import type { FetchedSource } from "@/lib/domain/citation-check";
import type { Cache } from "./memory-cache";

export type EdgarClientDeps = {
  /** "AppName contact@email", required by the SEC on every request. */
  userAgent: string;
  fetch?: typeof fetch;
  /** Defaults to an in-memory cache. */
  cache?: Cache;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type CompanyProfile = {
  cik: string;
  name: string;
  sic: string | null;
  sicDescription: string | null;
  tickers: string[];
};

/** A filing is a FetchedSource, so reports can cite it by id. */
export type Filing = FetchedSource & {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  acceptedAt: string;
  description: string | null;
};

export type EdgarClient = {
  lookupCik(ticker: string): Promise<string | null>;
};

export function createEdgarClient(deps: EdgarClientDeps): EdgarClient {
  return {
    async lookupCik(ticker) {
      throw new Error(`lookupCik is not implemented (${ticker}, ${typeof deps})`);
    },
  };
}

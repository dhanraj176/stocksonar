import "server-only";
import { z } from "zod";
import { numberToCents } from "@/lib/domain/money";
import { parseMarketResponse } from "./market-error";
import { createFinnhubFetcher } from "./market-fetch";
import { createMemoryCache, type Cache } from "./memory-cache";

const API_BASE = "https://finnhub.io/api/v1";

export type MarketClientDeps = {
  apiKey: string;
  fetch?: typeof fetch;
  /** Defaults to an in-memory cache. */
  cache?: Cache;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type Quote = {
  ticker: string;
  priceCents: number;
  previousCloseCents: number;
  /** When Finnhub says the price was set, as a UTC ISO string. */
  asOf: string;
};

export type MarketClient = {
  /** Null for a ticker Finnhub doesn't know. */
  getQuote(ticker: string): Promise<Quote | null>;
};

/** The parts of /quote the client uses. Unknown keys (d and dp can be null) are stripped. */
const quoteSchema = z.object({
  c: z.number().nonnegative(),
  pc: z.number().nonnegative(),
  t: z.number().int().nonnegative(),
});

export function createMarketClient(deps: MarketClientDeps): MarketClient {
  const finnhub = createFinnhubFetcher(deps);
  void (deps.cache ?? createMemoryCache({ now: deps.now }));

  return {
    async getQuote(ticker) {
      const symbol = normalizeTicker(ticker);
      const url = `${API_BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
      const raw = parseMarketResponse(quoteSchema, await finnhub.getJson(url), url);
      return {
        ticker: symbol,
        priceCents: numberToCents(raw.c),
        previousCloseCents: numberToCents(raw.pc),
        asOf: new Date(raw.t * 1000).toISOString(),
      };
    },
  };
}

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

/** Finnhub writes share classes with a dot (BRK.B), so unlike EDGAR the dot stays. */
function normalizeTicker(ticker: string): string {
  const symbol = ticker.trim().toUpperCase();
  if (!TICKER.test(symbol)) {
    throw new RangeError(`Not a ticker: ${JSON.stringify(ticker.slice(0, 20))}`);
  }
  return symbol;
}

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

/**
 * The parts of /quote the client uses. Unknown keys are stripped: d and dp come back null for an
 * unknown symbol, so they take no part in deciding whether the quote is real.
 */
const quoteSchema = z.object({
  c: z.number().nonnegative(),
  h: z.number().nonnegative(),
  l: z.number().nonnegative(),
  o: z.number().nonnegative(),
  pc: z.number().nonnegative(),
  t: z.number().int().nonnegative(),
});

type RawQuote = z.infer<typeof quoteSchema>;

/** Finnhub answers an unknown symbol with 200 and zeros in every price field and the timestamp. */
function isUnknownSymbol(quote: RawQuote): boolean {
  return quote.c === 0 && quote.h === 0 && quote.l === 0 && quote.o === 0 && quote.pc === 0 && quote.t === 0;
}

/** A real quote has a price and a timestamp. A half-zero one is a bad response, not an unknown ticker. */
const realQuoteSchema = quoteSchema.refine((quote) => quote.c > 0 && quote.t > 0, {
  message: "quote has no price or no timestamp",
});

export function createMarketClient(deps: MarketClientDeps): MarketClient {
  const finnhub = createFinnhubFetcher(deps);
  void (deps.cache ?? createMemoryCache({ now: deps.now }));

  return {
    async getQuote(ticker) {
      const symbol = normalizeTicker(ticker);
      const url = `${API_BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
      const body = await finnhub.getJson(url);
      const shape = parseMarketResponse(quoteSchema, body, url);
      if (isUnknownSymbol(shape)) return null;
      const raw = parseMarketResponse(realQuoteSchema, body, url);
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

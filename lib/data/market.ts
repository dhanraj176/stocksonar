import "server-only";
import { z } from "zod";
import type { FetchedSource } from "@/lib/domain/citation-check";
import { numberToCents } from "@/lib/domain/money";
import { parseMarketResponse } from "./market-error";
import { createFinnhubFetcher } from "./market-fetch";
import { createMemoryCache, type Cache } from "./memory-cache";

const API_BASE = "https://finnhub.io/api/v1";
const QUOTE_TTL_MS = 60 * 1000;
const MAX_NEWS_ITEMS = 20;
const MAX_HEADLINE_CHARS = 300;
const MAX_SUMMARY_CHARS = 1000;

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

/** A news article is a FetchedSource, so reports can cite it by id. */
export type NewsItem = FetchedSource & {
  headline: string;
  summary: string | null;
  publisher: string;
  /** UTC ISO string. */
  publishedAt: string;
};

export type MarketClient = {
  /** Null for a ticker Finnhub doesn't know. */
  getQuote(ticker: string): Promise<Quote | null>;
  /** Newest first. `from` and `to` are YYYY-MM-DD. */
  getCompanyNews(ticker: string, from: string, to: string): Promise<NewsItem[]>;
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

/**
 * Headlines and summaries come from third parties and may hold instructions meant for an LLM.
 * They stay plain data: control characters go, whitespace collapses, length is capped by code
 * point. buildReportPrompt escapes them when they reach a prompt.
 */
function cleanText(max: number) {
  return z
    .string()
    .transform((text) => {
      const flat = text.replace(/[\t\n\r]/g, " ").replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();
      return Array.from(flat).slice(0, max).join("");
    });
}

/** Only web links, with no embedded credentials. */
const webUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
});

/** The parts of a /company-news article the client uses. Unknown keys are stripped. */
const newsArticleSchema = z.object({
  id: z.number().int().nonnegative(),
  datetime: z.number().int().positive(),
  headline: cleanText(MAX_HEADLINE_CHARS).pipe(z.string().min(1)),
  summary: cleanText(MAX_SUMMARY_CHARS),
  source: cleanText(MAX_HEADLINE_CHARS).pipe(z.string().min(1)),
  url: webUrlSchema,
});

/** The body must be a list. One malformed article is dropped on its own, not allowed to fail the rest. */
const newsResponseSchema = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = newsArticleSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** What the client caches. Null is a cached "unknown ticker". Re-validated on read. */
const cachedQuoteSchema = z
  .object({
    ticker: z.string(),
    priceCents: z.number().int().nonnegative(),
    previousCloseCents: z.number().int().nonnegative(),
    asOf: z.iso.datetime(),
  })
  .nullable();

export function createMarketClient(deps: MarketClientDeps): MarketClient {
  const finnhub = createFinnhubFetcher(deps);
  const cache = deps.cache ?? createMemoryCache({ now: deps.now });

  async function cached<T>(key: string, ttlMs: number, schema: z.ZodType<T>, load: () => Promise<T>): Promise<T> {
    const hit = schema.safeParse(await cache.get(key));
    if (hit.success) return hit.data;
    const value = await load();
    await cache.set(key, value, ttlMs);
    return value;
  }

  return {
    async getQuote(ticker) {
      const symbol = normalizeTicker(ticker);
      return cached(`market:quote:${symbol}`, QUOTE_TTL_MS, cachedQuoteSchema, async () => {
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
      });
    },
    async getCompanyNews(ticker, from, to) {
      const symbol = normalizeTicker(ticker);
      const url = `${API_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`;
      const articles = parseMarketResponse(newsResponseSchema, await finnhub.getJson(url), url);
      return newestUnique(articles)
        .slice(0, MAX_NEWS_ITEMS)
        .map((article) => ({
          id: `finnhub:news:${article.id}`,
          url: article.url,
          headline: article.headline,
          summary: article.summary || null,
          publisher: article.source,
          publishedAt: new Date(article.datetime * 1000).toISOString(),
        }));
    },
  };
}

type NewsArticle = z.output<typeof newsArticleSchema>;

/** Newest first (ties by id), keeping the first copy seen of each article id and each URL. */
function newestUnique(articles: NewsArticle[]): NewsArticle[] {
  const ids = new Set<number>();
  const urls = new Set<string>();
  const unique: NewsArticle[] = [];
  for (const article of [...articles].sort((a, b) => b.datetime - a.datetime || a.id - b.id)) {
    if (ids.has(article.id) || urls.has(article.url)) continue;
    ids.add(article.id);
    urls.add(article.url);
    unique.push(article);
  }
  return unique;
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

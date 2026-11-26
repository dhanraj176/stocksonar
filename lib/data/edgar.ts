import { z } from "zod";
import type { FetchedSource } from "@/lib/domain/citation-check";
import { EdgarError } from "./edgar-error";
import { createMemoryCache, type Cache } from "./memory-cache";
import { createSecFetcher } from "./sec-fetch";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const TICKERS_TTL_MS = 24 * 60 * 60 * 1000;

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

/** SEC shape: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... } */
const tickerMapSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number().int().nonnegative(), ticker: z.string().min(1) }),
);

/** What the client caches: normalized ticker -> 10-digit CIK. Re-validated on read. */
const cikByTickerSchema = z.record(z.string(), z.string().regex(/^\d{10}$/));

export function createEdgarClient(deps: EdgarClientDeps): EdgarClient {
  const sec = createSecFetcher(deps);
  const cache = deps.cache ?? createMemoryCache({ now: deps.now });

  async function cached<T>(key: string, ttlMs: number, schema: z.ZodType<T>, load: () => Promise<T>): Promise<T> {
    const hit = schema.safeParse(await cache.get(key));
    if (hit.success) return hit.data;
    const value = await load();
    await cache.set(key, value, ttlMs);
    return value;
  }

  async function loadCikByTicker(): Promise<Record<string, string>> {
    const map = parseResponse(tickerMapSchema, await sec.getJson(TICKERS_URL), TICKERS_URL);
    const cikByTicker: Record<string, string> = {};
    for (const entry of Object.values(map)) {
      cikByTicker[normalizeTicker(entry.ticker)] = padCik(entry.cik_str);
    }
    return cikByTicker;
  }

  return {
    async lookupCik(ticker) {
      const cikByTicker = await cached("edgar:tickers", TICKERS_TTL_MS, cikByTickerSchema, loadCikByTicker);
      return cikByTicker[normalizeTicker(ticker)] ?? null;
    },
  };
}

/** The SEC writes share classes with a dash: BRK.B -> BRK-B. */
function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replaceAll(".", "-");
}

function padCik(cik: number | string): string {
  return String(cik).padStart(10, "0");
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, url: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    throw new EdgarError("invalid-response", `Unexpected SEC response shape: ${url}`, { url, issues });
  }
  return result.data;
}

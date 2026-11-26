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
  getCompanyProfile(cik: string): Promise<CompanyProfile>;
};

/** SEC shape: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... } */
const tickerMapSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number().int().nonnegative(), ticker: z.string().min(1) }),
);

/** What the client caches: normalized ticker -> 10-digit CIK. Re-validated on read. */
const cikByTickerSchema = z.record(z.string(), z.string().regex(/^\d{10}$/));

/** The parts of data.sec.gov/submissions/CIK##########.json the client uses. Unknown keys are stripped. */
const submissionsSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  name: z.string().min(1),
  sic: z.string(),
  sicDescription: z.string(),
  tickers: z.array(z.string()),
});

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
    async getCompanyProfile(cik) {
      const url = submissionsUrl(cik);
      const submissions = parseResponse(submissionsSchema, await sec.getJson(url), url);
      return {
        cik: submissions.cik,
        name: submissions.name,
        sic: submissions.sic || null,
        sicDescription: submissions.sicDescription || null,
        tickers: submissions.tickers,
      };
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

/** Accepts "320193" or "0000320193". Throws RangeError before anything is fetched. */
function normalizeCik(cik: string): string {
  if (!/^\d{1,10}$/.test(cik)) {
    throw new RangeError(`Not a CIK: ${JSON.stringify(cik)}`);
  }
  return padCik(cik);
}

function submissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${normalizeCik(cik)}.json`;
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, url: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    throw new EdgarError("invalid-response", `Unexpected SEC response shape: ${url}`, { url, issues });
  }
  return result.data;
}

import { z } from "zod";
import type { FetchedSource } from "@/lib/domain/citation-check";
import { EdgarError } from "./edgar-error";
import { createMemoryCache, type Cache } from "./memory-cache";
import { createSecFetcher } from "./sec-fetch";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const TICKERS_TTL_MS = 24 * 60 * 60 * 1000;
const SUBMISSIONS_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FILINGS_LIMIT = 10;

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
  /** Newest first. `forms` match exactly ("8-K" does not include "8-K/A"). `limit` defaults to 10. */
  getRecentFilings(cik: string, options: { forms: string[]; limit?: number }): Promise<Filing[]>;
};

/** SEC shape: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... } */
const tickerMapSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number().int().nonnegative(), ticker: z.string().min(1) }),
);

/** What the client caches: normalized ticker -> 10-digit CIK. Re-validated on read. */
const cikByTickerSchema = z.record(z.string(), z.string().regex(/^\d{10}$/));

/** filings.recent is columnar: row i of every array describes the same filing. */
const recentFilingsSchema = z
  .object({
    accessionNumber: z.array(z.string().regex(/^\d{10}-\d{2}-\d{6}$/)),
    form: z.array(z.string()),
    filingDate: z.array(z.iso.date()),
    reportDate: z.array(z.union([z.iso.date(), z.literal("")])),
    acceptanceDateTime: z.array(z.iso.datetime({ offset: true })),
    primaryDocument: z.array(z.string()),
    primaryDocDescription: z.array(z.string()),
  })
  .refine((columns) => new Set(Object.values(columns).map((column) => column.length)).size <= 1, {
    message: "filings.recent columns have different lengths",
  });

/**
 * The parts of data.sec.gov/submissions/CIK##########.json the client uses. Unknown keys are
 * stripped. There are no transforms, so the parsed value can be cached and re-validated on read.
 */
const submissionsSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  name: z.string().min(1),
  sic: z.string(),
  sicDescription: z.string(),
  tickers: z.array(z.string()),
  filings: z.object({ recent: recentFilingsSchema }),
});

type Submissions = z.infer<typeof submissionsSchema>;

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

  async function getSubmissions(cik: string): Promise<Submissions> {
    const url = submissionsUrl(cik);
    return cached(`edgar:submissions:${normalizeCik(cik)}`, SUBMISSIONS_TTL_MS, submissionsSchema, async () =>
      parseResponse(submissionsSchema, await sec.getJson(url), url),
    );
  }

  return {
    async lookupCik(ticker) {
      const cikByTicker = await cached("edgar:tickers", TICKERS_TTL_MS, cikByTickerSchema, loadCikByTicker);
      return cikByTicker[normalizeTicker(ticker)] ?? null;
    },
    async getCompanyProfile(cik) {
      const submissions = await getSubmissions(cik);
      return {
        cik: submissions.cik,
        name: submissions.name,
        sic: submissions.sic || null,
        sicDescription: submissions.sicDescription || null,
        tickers: submissions.tickers,
      };
    },
    async getRecentFilings(cik, { forms, limit = DEFAULT_FILINGS_LIMIT }) {
      const submissions = await getSubmissions(cik);
      const recent = submissions.filings.recent;
      const wanted = new Set(forms);
      const filings: Filing[] = [];
      for (let row = 0; row < recent.form.length && filings.length < limit; row++) {
        if (wanted.has(recent.form[row])) filings.push(toFiling(submissions.cik, recent, row));
      }
      return filings;
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

function toFiling(cik: string, recent: Submissions["filings"]["recent"], row: number): Filing {
  const accessionNumber = recent.accessionNumber[row];
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replaceAll("-", "")}`;
  const document = recent.primaryDocument[row];
  return {
    id: `edgar:${accessionNumber}`,
    url: isSafeDocumentPath(document) ? `${folder}/${document}` : `${folder}/${accessionNumber}-index.htm`,
    accessionNumber,
    form: recent.form[row],
    filingDate: recent.filingDate[row],
    reportDate: recent.reportDate[row] || null,
    acceptedAt: new Date(recent.acceptanceDateTime[row]).toISOString(),
    description: recent.primaryDocDescription[row] || null,
  };
}

/** primaryDocument comes from SEC data, so it must be a plain relative path before it goes into a URL. */
function isSafeDocumentPath(document: string): boolean {
  return /^[\w./-]+$/.test(document) && !document.split("/").includes("..");
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, url: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    throw new EdgarError("invalid-response", `Unexpected SEC response shape: ${url}`, { url, issues });
  }
  return result.data;
}

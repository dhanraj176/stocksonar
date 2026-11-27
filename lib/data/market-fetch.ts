import { MarketDataError } from "./market-error";

const FINNHUB_HOST = "finnhub.io";
/** Finnhub allows 60 calls a minute on the free plan (and 30 a second); 50 leaves headroom. */
const MAX_REQUESTS_PER_WINDOW = 50;
const WINDOW_MS = 60_000;

export type FinnhubFetcherDeps = {
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type FinnhubFetcher = {
  getJson(url: string): Promise<unknown>;
};

/**
 * Every request from one fetcher shares one limiter, so create a single fetcher per process.
 * The key goes in a header, never the URL, so it can't leak through logs or error messages.
 */
export function createFinnhubFetcher(deps: FinnhubFetcherDeps): FinnhubFetcher {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** Start times of the last MAX_REQUESTS_PER_WINDOW requests, including ones still waiting. */
  const starts: number[] = [];

  /** Reserves a start time synchronously, so concurrent callers queue in call order. */
  async function waitForSlot() {
    const current = now();
    const full = starts.length >= MAX_REQUESTS_PER_WINDOW;
    const start = full ? Math.max(current, starts[starts.length - MAX_REQUESTS_PER_WINDOW] + WINDOW_MS) : current;
    starts.push(start);
    if (starts.length > MAX_REQUESTS_PER_WINDOW) starts.shift();
    if (start > current) await sleep(start - current);
  }

  return {
    async getJson(url) {
      assertFinnhubUrl(url);
      await waitForSlot();
      const response = await fetchImpl(url, { headers: { "X-Finnhub-Token": deps.apiKey }, redirect: "error" });
      if (!response.ok) {
        const kind = response.status === 429 ? "rate-limited" : "http";
        throw new MarketDataError(kind, `Finnhub request failed with ${response.status}: ${url}`, { status: response.status, url });
      }
      try {
        return (await response.json()) as unknown;
      } catch {
        throw new MarketDataError("invalid-response", `Finnhub response is not JSON: ${url}`, { url });
      }
    },
  };
}

function assertFinnhubUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing to fetch a non-Finnhub URL: ${url}`);
  }
  const allowed =
    parsed.protocol === "https:" &&
    parsed.hostname === FINNHUB_HOST &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "";
  if (!allowed) {
    throw new Error(`Refusing to fetch a non-Finnhub URL: ${url}`);
  }
}

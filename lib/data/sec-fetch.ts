import { EdgarError } from "./edgar-error";

/** The SEC allows 10 requests/second across its hosts; 125 ms apart is 8/s, leaving headroom. */
const MIN_SPACING_MS = 125;
const SEC_HOSTS = new Set(["www.sec.gov", "data.sec.gov"]);

export type SecFetcherDeps = {
  /** "AppName contact@email", required by the SEC on every request. */
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type SecFetcher = {
  getJson(url: string): Promise<unknown>;
  getText(url: string): Promise<string>;
};

/**
 * Every request from one fetcher shares one limiter, so create a single fetcher per process.
 * Each serverless instance still gets its own limiter; caching keeps that traffic low.
 */
export function createSecFetcher(deps: SecFetcherDeps): SecFetcher {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let nextSlot = 0;

  /** Reserves a start time synchronously, so concurrent callers queue in call order. */
  async function waitForSlot() {
    const current = now();
    const start = Math.max(current, nextSlot);
    nextSlot = start + MIN_SPACING_MS;
    if (start > current) await sleep(start - current);
  }

  async function request(url: string): Promise<string> {
    assertSecUrl(url);
    await waitForSlot();
    const response = await fetchImpl(url, { headers: { "User-Agent": deps.userAgent }, redirect: "error" });
    if (!response.ok) {
      throw new EdgarError("http", `SEC request failed with ${response.status}: ${url}`, { status: response.status, url });
    }
    return response.text();
  }

  return {
    async getJson(url) {
      const body = await request(url);
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new EdgarError("invalid-response", `SEC response is not JSON: ${url}`, { url });
      }
    },
    getText: request,
  };
}

function assertSecUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing to fetch a non-SEC URL: ${url}`);
  }
  const allowed =
    parsed.protocol === "https:" &&
    SEC_HOSTS.has(parsed.hostname) &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "";
  if (!allowed) {
    throw new Error(`Refusing to fetch a non-SEC URL: ${url}`);
  }
}

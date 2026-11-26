import { readFileSync } from "node:fs";
import { vi } from "vitest";

/** Test-only helpers. Reads saved SEC responses from local disk; never touches the network. */

export const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const AAPL_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK0000320193.json";
export const SALE_XML_URL = "https://www.sec.gov/Archives/edgar/data/320193/000114036126045775/form4.xml";
export const AWARD_XML_URL = "https://www.sec.gov/Archives/edgar/data/320193/000114036126040127/form4.xml";

export function readFixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

export function readJsonFixture(name: string): unknown {
  return JSON.parse(readFixture(name));
}

type Route = string | { status: number; body: string };

/** A fetch that serves only the given URLs and throws on anything else. */
export function fakeFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const route = routes[url];
    if (route === undefined) {
      throw new Error(`Unexpected request in test: ${url}`);
    }
    const { status, body } = typeof route === "string" ? { status: 200, body: route } : route;
    return new Response(body, { status });
  });
}

/** Makes the global fetch throw, so a test that forgets to inject one fails loudly. */
export function forbidGlobalFetch() {
  vi.stubGlobal("fetch", () => {
    throw new Error("Tests must not use the global fetch");
  });
}

/** A manual clock for TTL tests. */
export function manualClock(start = Date.UTC(2026, 10, 26)) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

import { readFileSync } from "node:fs";
import { vi } from "vitest";

/** Test-only helpers. Reads saved Finnhub responses from local disk; never touches the network. */

export const TEST_API_KEY = "test-key-not-real-0123456789";
export const QUOTE_URL = "https://finnhub.io/api/v1/quote?symbol=AAPL";

export function readFixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

type Route = string | { status: number; body: string };

/** A fetch that serves only the given URLs and throws on anything else. */
export function fakeFetch(routes: Record<string, Route>) {
  return vi.fn<typeof fetch>(async (input) => {
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

/** A manual clock for TTL and rate-limit tests. */
export function manualClock(start = Date.UTC(2026, 10, 26)) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

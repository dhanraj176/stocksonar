import { beforeEach, describe, expect, it } from "vitest";
import { QUOTE_URL, TEST_API_KEY, fakeFetch, forbidGlobalFetch, manualClock } from "./fixtures/market/fixtures";
import { MarketDataError } from "./market-error";
import { createFinnhubFetcher } from "./market-fetch";

beforeEach(forbidGlobalFetch);

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const clock = manualClock();
  const fetch = fakeFetch(routes);
  const fetcher = createFinnhubFetcher({ apiKey: TEST_API_KEY, fetch, now: clock.now, sleep: async () => {} });
  return { fetcher, fetch, clock };
}

describe("createFinnhubFetcher", () => {
  it("sends the key in the X-Finnhub-Token header and never in the URL", async () => {
    const { fetcher, fetch } = setup({ [QUOTE_URL]: '{"c":1}' });

    expect(await fetcher.getJson(QUOTE_URL)).toEqual({ c: 1 });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).not.toContain(TEST_API_KEY);
    expect(new Headers(init?.headers).get("X-Finnhub-Token")).toBe(TEST_API_KEY);
    expect(init?.redirect).toBe("error");
  });

  it.each([
    "http://finnhub.io/api/v1/quote?symbol=AAPL",
    "https://evil.example.com/api/v1/quote?symbol=AAPL",
    "https://finnhub.io.evil.example.com/api/v1/quote",
    "https://user:pw@finnhub.io/api/v1/quote",
    "https://finnhub.io:8443/api/v1/quote",
    "not a url",
  ])("refuses to fetch %j and sends nothing", async (url) => {
    const { fetcher, fetch } = setup({});

    await expect(fetcher.getJson(url)).rejects.toThrow("Refusing to fetch a non-Finnhub URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns a non-2xx response into an http error without the key", async () => {
    const { fetcher } = setup({ [QUOTE_URL]: { status: 500, body: "boom" } });

    const error = await fetcher.getJson(QUOTE_URL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MarketDataError);
    expect(error).toMatchObject({ kind: "http", status: 500, url: QUOTE_URL });
    expect(String((error as Error).message)).not.toContain(TEST_API_KEY);
  });

  it("treats 429 as rate-limited", async () => {
    const { fetcher } = setup({ [QUOTE_URL]: { status: 429, body: "slow down" } });

    await expect(fetcher.getJson(QUOTE_URL)).rejects.toMatchObject({ kind: "rate-limited", status: 429 });
  });

  it("turns a non-JSON body into an invalid-response error", async () => {
    const { fetcher } = setup({ [QUOTE_URL]: "<html>not json</html>" });

    await expect(fetcher.getJson(QUOTE_URL)).rejects.toMatchObject({ kind: "invalid-response", url: QUOTE_URL });
  });
});

describe("rate limit", () => {
  const url = (n: number) => `https://finnhub.io/api/v1/quote?symbol=T${n}`;
  const routes = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, n) => [url(n), "{}"]));

  function limited(count: number) {
    const clock = manualClock();
    const sleeps: number[] = [];
    const fetch = fakeFetch(routes(count));
    const fetcher = createFinnhubFetcher({
      apiKey: TEST_API_KEY,
      fetch,
      now: clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    });
    return { fetcher, fetch, clock, sleeps };
  }

  it("starts 50 requests at once, then waits until the oldest is a minute old", async () => {
    const { fetcher, sleeps } = limited(52);

    for (let n = 0; n < 50; n++) await fetcher.getJson(url(n));
    expect(sleeps).toEqual([]);

    await fetcher.getJson(url(50));
    expect(sleeps).toEqual([60_000]);

    // The first 50 have aged out by now, so the next request goes straight through.
    await fetcher.getJson(url(51));
    expect(sleeps).toEqual([60_000]);
  });

  it("queues concurrent callers in call order", async () => {
    const { fetcher, fetch, sleeps } = limited(52);

    await Promise.all(Array.from({ length: 52 }, (_, n) => fetcher.getJson(url(n))));

    expect(fetch.mock.calls.map(([called]) => String(called))).toEqual(Array.from({ length: 52 }, (_, n) => url(n)));
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBe(60_000);
  });
});

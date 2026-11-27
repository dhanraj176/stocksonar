import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_API_KEY, fakeFetch, forbidGlobalFetch, manualClock, readFixture } from "./fixtures/market/fixtures";
import { createMarketClient } from "./market";
import { MarketDataError } from "./market-error";

vi.mock("server-only", () => ({}));

const QUOTE_URL = (symbol: string) => `https://finnhub.io/api/v1/quote?symbol=${symbol}`;

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const clock = manualClock();
  const fetch = fakeFetch(routes);
  const client = createMarketClient({ apiKey: TEST_API_KEY, fetch, now: clock.now, sleep: async () => {} });
  return { client, fetch, clock };
}

beforeEach(forbidGlobalFetch);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getQuote", () => {
  const routes = { [QUOTE_URL("AAPL")]: readFixture("quote-aapl.json") };

  it("returns price and previous close in integer cents with a UTC as-of time", async () => {
    const { client } = setup(routes);

    expect(await client.getQuote("AAPL")).toEqual({
      ticker: "AAPL",
      priceCents: 17235,
      previousCloseCents: 17115,
      asOf: "2026-11-26T22:00:00.000Z",
    });
  });

  it("normalizes the ticker, so ' aapl ' and 'AAPL' are the same request", async () => {
    const { client, fetch } = setup(routes);

    const quote = await client.getQuote(" aapl ");

    expect(quote?.ticker).toBe("AAPL");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([QUOTE_URL("AAPL")]);
  });

  it("keeps the dot in share classes, which Finnhub spells BRK.B", async () => {
    const { client, fetch } = setup({ [QUOTE_URL("BRK.B")]: readFixture("quote-aapl.json") });

    expect((await client.getQuote("brk.b"))?.ticker).toBe("BRK.B");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["", "  ", "AAPL&token=x", "A B", "../quote", "WAYTOOLONGSYMBOL"])("throws RangeError for %j before any request", async (ticker) => {
    const { client, fetch } = setup(routes);

    await expect(client.getQuote(ticker)).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("getQuote for bad data", () => {
  it("returns null when every price field is zero (Finnhub's answer for an unknown symbol)", async () => {
    const { client } = setup({ [QUOTE_URL("ZZZZ")]: readFixture("quote-unknown.json") });

    expect(await client.getQuote("ZZZZ")).toBeNull();
  });

  it("treats d and dp of 0 the same as null when deciding a ticker is unknown", async () => {
    const body = JSON.stringify({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    const { client } = setup({ [QUOTE_URL("ZZZZ")]: body });

    expect(await client.getQuote("ZZZZ")).toBeNull();
  });

  it.each([
    ["a missing price", { pc: 171.1, t: 1795730400 }],
    ["a string price", { c: "172.34", pc: 171.1, t: 1795730400 }],
    ["a negative price", { c: -1, pc: 171.1, t: 1795730400 }],
    ["a missing timestamp", { c: 172.3, pc: 171.1 }],
    ["a zero price with a real previous close", { c: 0, h: 0, l: 0, o: 0, pc: 171.1, t: 1795730400 }],
    ["a price with no timestamp", { c: 172.3, h: 173, l: 170, o: 171, pc: 171.1, t: 0 }],
  ])("throws invalid-response for %s", async (_name, body) => {
    const { client } = setup({ [QUOTE_URL("AAPL")]: JSON.stringify(body) });

    const error = await client.getQuote("AAPL").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MarketDataError);
    expect(error).toMatchObject({ kind: "invalid-response" });
  });
});

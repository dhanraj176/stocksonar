import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TICKERS_URL,
  fakeFetch,
  forbidGlobalFetch,
  manualClock,
  readFixture,
  readJsonFixture,
} from "./fixtures/edgar/fixtures";
import { createEdgarClient } from "./edgar";

const HOUR = 60 * 60 * 1000;

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const clock = manualClock();
  const fetch = fakeFetch(routes);
  const client = createEdgarClient({
    userAgent: "StockSonar test@example.com",
    fetch,
    now: clock.now,
    sleep: async () => {},
  });
  return { client, fetch, clock };
}

beforeEach(forbidGlobalFetch);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupCik", () => {
  const routes = { [TICKERS_URL]: readFixture("company-tickers.json") };

  it.each([
    ["AAPL", "0000320193"],
    ["msft", "0000789019"],
    [" brk.b ", "0001067983"],
    ["BRK-B", "0001067983"],
  ])("maps %j to the zero-padded CIK %s", async (ticker, cik) => {
    const { client } = setup(routes);

    expect(await client.lookupCik(ticker)).toBe(cik);
  });

  it("returns null for a ticker the SEC does not list", async () => {
    const { client } = setup(routes);

    expect(await client.lookupCik("ZZZZ")).toBeNull();
  });

  it("fetches the ticker map once and reuses it for 24 hours", async () => {
    const { client, fetch, clock } = setup(routes);

    await client.lookupCik("AAPL");
    clock.advance(23 * HOUR);
    await client.lookupCik("MSFT");
    expect(fetch).toHaveBeenCalledTimes(1);

    clock.advance(1 * HOUR);
    await client.lookupCik("AAPL");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws invalid-response when an entry has no numeric cik_str", async () => {
    const map = readJsonFixture("company-tickers.json") as Record<string, Record<string, unknown>>;
    map["0"].cik_str = "320193";
    const { client } = setup({ [TICKERS_URL]: JSON.stringify(map) });

    await expect(client.lookupCik("AAPL")).rejects.toMatchObject({ name: "EdgarError", kind: "invalid-response" });
  });
});

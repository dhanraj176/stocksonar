import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AAPL_SUBMISSIONS_URL,
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

type Submissions = Record<string, unknown> & { filings: { recent: Record<string, unknown[]> } };

function aaplSubmissions(): Submissions {
  return readJsonFixture("submissions-aapl.json") as Submissions;
}

describe("getCompanyProfile", () => {
  it("returns the name, SIC code and SIC description from the submissions file", async () => {
    const { client } = setup({ [AAPL_SUBMISSIONS_URL]: readFixture("submissions-aapl.json") });

    expect(await client.getCompanyProfile("0000320193")).toEqual({
      cik: "0000320193",
      name: "Apple Inc.",
      sic: "3571",
      sicDescription: "Electronic Computers",
      tickers: ["AAPL"],
    });
  });

  it("accepts a CIK without leading zeros", async () => {
    const { client, fetch } = setup({ [AAPL_SUBMISSIONS_URL]: readFixture("submissions-aapl.json") });

    const profile = await client.getCompanyProfile("320193");

    expect(profile.cik).toBe("0000320193");
    expect(fetch).toHaveBeenCalledWith(AAPL_SUBMISSIONS_URL, expect.anything());
  });

  it("returns null SIC fields when the SEC leaves them empty", async () => {
    const body = { ...aaplSubmissions(), sic: "", sicDescription: "" };
    const { client } = setup({ [AAPL_SUBMISSIONS_URL]: JSON.stringify(body) });

    expect(await client.getCompanyProfile("0000320193")).toMatchObject({ sic: null, sicDescription: null });
  });

  it("throws invalid-response when a field has the wrong type", async () => {
    const body = { ...aaplSubmissions(), sic: 3571 };
    const { client } = setup({ [AAPL_SUBMISSIONS_URL]: JSON.stringify(body) });

    await expect(client.getCompanyProfile("0000320193")).rejects.toMatchObject({
      name: "EdgarError",
      kind: "invalid-response",
      url: AAPL_SUBMISSIONS_URL,
    });
  });

  it.each(["", "abc", "12345678901", "-320193", "../320193"])("rejects the malformed CIK %j without fetching", async (cik) => {
    const { client, fetch } = setup({});

    await expect(client.getCompanyProfile(cik)).rejects.toThrow(RangeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

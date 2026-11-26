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
import { validateReport } from "@/lib/domain/citation-check";
import { createEdgarClient } from "./edgar";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

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

describe("getRecentFilings", () => {
  const routes = { [AAPL_SUBMISSIONS_URL]: readFixture("submissions-aapl.json") };

  it("returns only the requested forms, newest first", async () => {
    const { client } = setup(routes);

    const filings = await client.getRecentFilings("0000320193", { forms: ["10-K", "10-Q", "8-K"] });

    expect(filings.map((f) => [f.form, f.accessionNumber])).toEqual([
      ["8-K", "0001140361-26-042798"],
      ["10-K", "0000320193-26-000026"],
      ["8-K", "0000320193-26-000024"],
      ["10-Q", "0000320193-26-000020"],
    ]);
  });

  it("stops at the limit, which defaults to 10", async () => {
    const { client } = setup(routes);

    const two = await client.getRecentFilings("0000320193", { forms: ["10-K", "10-Q", "8-K"], limit: 2 });
    const form4s = await client.getRecentFilings("0000320193", { forms: ["4"] });

    expect(two.map((f) => f.accessionNumber)).toEqual(["0001140361-26-042798", "0000320193-26-000026"]);
    expect(form4s).toHaveLength(10);
    expect(form4s[9].accessionNumber).toBe("0001140361-26-039785");
  });

  it("builds a citable source id and the filing's sec.gov URL", async () => {
    const { client } = setup(routes);

    const [tenK] = await client.getRecentFilings("0000320193", { forms: ["10-K"] });

    expect(tenK).toEqual({
      id: "edgar:0000320193-26-000026",
      url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm",
      accessionNumber: "0000320193-26-000026",
      form: "10-K",
      filingDate: "2026-11-03",
      reportDate: "2026-09-26",
      acceptedAt: "2026-11-03T13:05:15.000Z",
      description: "10-K",
    });
  });

  it("turns empty report dates and descriptions into null", async () => {
    const { client } = setup(routes);

    const [form144] = await client.getRecentFilings("0000320193", { forms: ["144"], limit: 1 });

    expect(form144).toMatchObject({ accessionNumber: "0001950047-26-011519", reportDate: null, description: null });
  });

  it("normalizes the acceptance time to a UTC ISO timestamp", async () => {
    const body = aaplSubmissions();
    body.filings.recent.acceptanceDateTime[12] = "2026-11-03T08:05:15-05:00";
    const { client } = setup({ [AAPL_SUBMISSIONS_URL]: JSON.stringify(body) });

    const [tenK] = await client.getRecentFilings("0000320193", { forms: ["10-K"] });

    expect(tenK.acceptedAt).toBe("2026-11-03T13:05:15.000Z");
  });

  it.each(["../../../../evil.htm", "", "a b.htm", "https://example.com/x.htm"])(
    "links to the filing index instead of the unsafe primary document %j",
    async (document) => {
      const body = aaplSubmissions();
      body.filings.recent.primaryDocument[12] = document;
      const { client } = setup({ [AAPL_SUBMISSIONS_URL]: JSON.stringify(body) });

      const [tenK] = await client.getRecentFilings("0000320193", { forms: ["10-K"] });

      expect(tenK.url).toBe(
        "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm",
      );
    },
  );

  it("throws invalid-response when the filing columns have different lengths", async () => {
    const body = aaplSubmissions();
    body.filings.recent.form.pop();
    const { client } = setup({ [AAPL_SUBMISSIONS_URL]: JSON.stringify(body) });

    await expect(client.getRecentFilings("0000320193", { forms: ["10-K"] })).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("throws invalid-response for a malformed accession number", async () => {
    const body = aaplSubmissions();
    body.filings.recent.accessionNumber[12] = "../0000320193";
    const { client } = setup({ [AAPL_SUBMISSIONS_URL]: JSON.stringify(body) });

    await expect(client.getRecentFilings("0000320193", { forms: ["10-K"] })).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("returns filings the citation check accepts as fetched sources", async () => {
    const { client } = setup(routes);
    const filings = await client.getRecentFilings("0000320193", { forms: ["10-K", "4"] });

    const result = validateReport(
      {
        bull: [{ text: "The latest 10-K was filed on 2026-11-03.", sourceIds: ["edgar:0000320193-26-000026"] }],
        bear: [{ text: "An officer sold shares on 2026-11-24.", sourceIds: ["edgar:0001140361-26-045775"] }],
      },
      filings,
    );

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("shares one submissions request between the profile and filings for 10 minutes", async () => {
    const { client, fetch, clock } = setup(routes);

    await client.getCompanyProfile("0000320193");
    await client.getRecentFilings("320193", { forms: ["10-K"] });
    clock.advance(9 * MINUTE);
    await client.getRecentFilings("0000320193", { forms: ["4"] });
    expect(fetch).toHaveBeenCalledTimes(1);

    clock.advance(1 * MINUTE);
    await client.getCompanyProfile("0000320193");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

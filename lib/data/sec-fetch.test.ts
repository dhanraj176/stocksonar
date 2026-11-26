import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgarError } from "./edgar-error";
import { createSecFetcher } from "./sec-fetch";

const USER_AGENT = "StockSonar test@example.com";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK0000320193.json";

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** A clock that only moves when sleep is called, so spacing is measured without real timers. */
function fakeClock(start = 10_000) {
  let time = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    advance: (ms: number) => (time += ms),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
  };
}

function setup(fetchImpl: typeof fetch = vi.fn(async () => okJson({ ok: true }))) {
  const clock = fakeClock();
  const fetcher = createSecFetcher({ userAgent: USER_AGENT, fetch: fetchImpl, now: clock.now, sleep: clock.sleep });
  return { fetcher, clock, fetchMock: vi.mocked(fetchImpl) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Tests must not use the global fetch");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSecFetcher", () => {
  it("sends the configured User-Agent on every request", async () => {
    const { fetcher, fetchMock } = setup();

    await fetcher.getJson(TICKERS_URL);
    await fetcher.getText(SUBMISSIONS_URL);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
    }
  });

  it("refuses to follow redirects, so a redirect cannot leave the SEC hosts", async () => {
    const { fetcher, fetchMock } = setup();

    await fetcher.getJson(TICKERS_URL);

    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("returns parsed JSON and raw text", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url) === TICKERS_URL ? okJson({ "0": { ticker: "AAPL" } }) : new Response("<xml/>", { status: 200 }),
    );
    const { fetcher } = setup(fetchMock);

    expect(await fetcher.getJson(TICKERS_URL)).toEqual({ "0": { ticker: "AAPL" } });
    expect(await fetcher.getText(SUBMISSIONS_URL)).toBe("<xml/>");
  });

  it.each([
    "https://example.com/files/company_tickers.json",
    "http://www.sec.gov/files/company_tickers.json",
    "https://www.sec.gov.evil.example/files/company_tickers.json",
    "https://user@www.sec.gov/files/company_tickers.json",
    "https://www.sec.gov:8443/files/company_tickers.json",
    "not a url",
  ])("rejects %s without calling fetch", async (url) => {
    const { fetcher, fetchMock } = setup();

    await expect(fetcher.getJson(url)).rejects.toThrow(/SEC/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("spaces back-to-back requests at least 125 ms apart", async () => {
    const { fetcher, clock, fetchMock } = setup();
    const startedAt: number[] = [];
    fetchMock.mockImplementation(async () => {
      startedAt.push(clock.now());
      return okJson({});
    });

    await Promise.all([fetcher.getJson(TICKERS_URL), fetcher.getJson(TICKERS_URL), fetcher.getJson(TICKERS_URL)]);

    expect(startedAt).toEqual([10_000, 10_125, 10_250]);
  });

  it("does not wait when the previous request started long enough ago", async () => {
    const { fetcher, clock } = setup();

    await fetcher.getJson(TICKERS_URL);
    clock.advance(500);
    await fetcher.getJson(TICKERS_URL);

    expect(clock.sleeps).toEqual([]);
  });

  it("throws an http EdgarError with the status and URL for a non-2xx response", async () => {
    const { fetcher } = setup(vi.fn(async () => new Response("Forbidden", { status: 403 })));

    const error = await fetcher.getJson(TICKERS_URL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EdgarError);
    expect(error).toMatchObject({ kind: "http", status: 403, url: TICKERS_URL });
  });

  it("throws an invalid-response EdgarError when the body is not JSON", async () => {
    const { fetcher } = setup(vi.fn(async () => new Response("<html>rate limited</html>", { status: 200 })));

    await expect(fetcher.getJson(TICKERS_URL)).rejects.toMatchObject({ kind: "invalid-response", url: TICKERS_URL });
  });
});

import { describe, expect, it } from "vitest";
import { summarizeInsiderTrades, type InsiderTradeInput } from "./insider-summary";

const jane = { cik: "0001111111", name: "Jane Doe", officerTitle: "CFO" };
const raj = { cik: "0002222222", name: "Raj Patel", officerTitle: null };

function trade(overrides: Partial<InsiderTradeInput> = {}): InsiderTradeInput {
  return {
    owners: [jane],
    code: "S",
    acquiredOrDisposed: "D",
    shares: 100,
    priceCents: 23000,
    date: "2026-10-01",
    ...overrides,
  };
}

describe("summarizeInsiderTrades", () => {
  it("summarizes an empty list as zeros with no dates", () => {
    expect(summarizeInsiderTrades([])).toEqual({
      tradeCount: 0,
      insiderCount: 0,
      insiders: [],
      netShares: 0,
      acquiredShares: 0,
      disposedShares: 0,
      totalValueCents: 0,
      unpricedTradeCount: 0,
      codeCounts: {},
      firstDate: null,
      lastDate: null,
    });
  });

  it("adds acquired and disposed shares and nets them", () => {
    const summary = summarizeInsiderTrades([
      trade({ code: "P", acquiredOrDisposed: "A", shares: 100 }),
      trade({ acquiredOrDisposed: "D", shares: 30 }),
      trade({ acquiredOrDisposed: "D", shares: 20 }),
    ]);

    expect(summary).toMatchObject({ tradeCount: 3, acquiredShares: 100, disposedShares: 50, netShares: 50 });
  });

  it("nets to a negative number when more shares were disposed", () => {
    const summary = summarizeInsiderTrades([trade({ shares: 50_000 })]);

    expect(summary).toMatchObject({ acquiredShares: 0, disposedShares: 50_000, netShares: -50_000 });
  });

  it("values priced trades in integer cents", () => {
    const summary = summarizeInsiderTrades([trade({ shares: 500, priceCents: 23000 }), trade({ shares: 2, priceCents: 1999 })]);

    expect(summary.totalValueCents).toBe(11_503_998);
    expect(summary.unpricedTradeCount).toBe(0);
  });

  it("leaves unpriced trades and gifts out of the value and counts them", () => {
    const summary = summarizeInsiderTrades([
      trade({ shares: 500, priceCents: 23000 }),
      trade({ code: "F", priceCents: null }),
      trade({ code: "G", priceCents: 0 }),
      trade({ code: "G", priceCents: 15000 }),
    ]);

    expect(summary.totalValueCents).toBe(11_500_000);
    expect(summary.unpricedTradeCount).toBe(3);
  });

  it("rounds each fractional-share value to the cent", () => {
    const summary = summarizeInsiderTrades([
      trade({ shares: 10.5, priceCents: 12345 }),
      trade({ shares: 0.5, priceCents: 1 }),
    ]);

    // 129,622.5 rounds to 129,623; 0.5 rounds to 1.
    expect(summary.totalValueCents).toBe(129_624);
    expect(Number.isInteger(summary.totalValueCents)).toBe(true);
  });

  it("adds fractional shares without float noise", () => {
    const summary = summarizeInsiderTrades([
      trade({ acquiredOrDisposed: "A", shares: 0.1 }),
      trade({ acquiredOrDisposed: "A", shares: 0.2 }),
      trade({ acquiredOrDisposed: "D", shares: 0.3 }),
    ]);

    expect(summary).toMatchObject({ acquiredShares: 0.3, disposedShares: 0.3, netShares: 0 });
  });

  it("counts distinct insiders by CIK, in order of first appearance", () => {
    const summary = summarizeInsiderTrades([
      trade({ owners: [jane] }),
      trade({ owners: [raj, jane] }),
      trade({ owners: [{ ...jane, name: "JANE DOE" }] }),
    ]);

    expect(summary.insiderCount).toBe(2);
    expect(summary.insiders).toEqual([jane, raj]);
  });

  it("counts trades by SEC code", () => {
    const summary = summarizeInsiderTrades([trade({ code: "S" }), trade({ code: "F" }), trade({ code: "S" })]);

    expect(summary.codeCounts).toEqual({ S: 2, F: 1 });
  });

  it("gives the first and last trade dates whatever the input order", () => {
    const summary = summarizeInsiderTrades([
      trade({ date: "2026-10-02" }),
      trade({ date: "2026-09-30" }),
      trade({ date: "2026-10-01" }),
    ]);

    expect(summary).toMatchObject({ firstDate: "2026-09-30", lastDate: "2026-10-02" });
  });

  it("throws a RangeError when the value is too large to hold in cents exactly", () => {
    expect(() => summarizeInsiderTrades([trade({ shares: 1e12, priceCents: 1e7 })])).toThrow(RangeError);
  });
});

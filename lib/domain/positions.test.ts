import { describe, expect, it } from "vitest";
import {
  POSITION_SOURCES,
  positionInputSchema,
  positionRowSchema,
  sourceSchema,
  tickerSchema,
} from "./positions";

const validRow = {
  id: "0b9f3a52-6c1e-4f0a-8d3e-2a7c5e9b1d44",
  user_id: "5d2e8c7a-1b34-4c6f-9a0d-3e8f7b6a2c11",
  ticker: "AAPL",
  quantity: "0.123456",
  cost_basis_cents: 12345,
  source: "csv",
  created_at: "2026-11-27T03:39:28.123456+00:00",
  updated_at: "2026-11-27T03:39:28.123456+00:00",
};

describe("tickerSchema", () => {
  it("trims and uppercases", () => {
    expect(tickerSchema.parse("  brk.b ")).toBe("BRK.B");
  });

  it.each(["A", "BRK-B", "ABCDEFGHIJ"])("accepts %s", (ticker) => {
    expect(tickerSchema.safeParse(ticker).success).toBe(true);
  });

  it.each(["", "1ABC", "ABCDEFGHIJK", "AB CD", "AB$"])("rejects %j", (ticker) => {
    expect(tickerSchema.safeParse(ticker).success).toBe(false);
  });
});

describe("sourceSchema", () => {
  it("lists the four sources", () => {
    expect(POSITION_SOURCES).toEqual(["csv", "screenshot", "manual", "brokerage"]);
  });

  it.each(["csv", "screenshot", "manual", "brokerage"])("accepts %s", (source) => {
    expect(sourceSchema.safeParse(source).success).toBe(true);
  });

  it.each(["plaid", ""])("rejects %j", (source) => {
    expect(sourceSchema.safeParse(source).success).toBe(false);
  });
});

describe("positionInputSchema", () => {
  it("parses valid input with an uppercased ticker and the quantity string untouched", () => {
    expect(
      positionInputSchema.parse({
        ticker: " aapl",
        quantity: "1.500000",
        costBasisCents: 15000,
        source: "manual",
      }),
    ).toEqual({ ticker: "AAPL", quantity: "1.500000", costBasisCents: 15000, source: "manual" });
  });

  it.each(["ticker", "quantity", "costBasisCents", "source"])("fails without %s", (field) => {
    const input: Record<string, unknown> = {
      ticker: "AAPL",
      quantity: "1",
      costBasisCents: 100,
      source: "csv",
    };
    delete input[field];
    expect(positionInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("positionRowSchema", () => {
  it("parses a PostgREST-shaped row", () => {
    expect(positionRowSchema.parse(validRow)).toEqual(validRow);
  });

  it("rejects a non-uuid id", () => {
    expect(positionRowSchema.safeParse({ ...validRow, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a numeric quantity, so a forgotten ::text cast fails loudly", () => {
    expect(positionRowSchema.safeParse({ ...validRow, quantity: 0.123456 }).success).toBe(false);
  });
});

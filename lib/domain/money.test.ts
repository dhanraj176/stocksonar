import { describe, expect, it } from "vitest";
import { dollarsToCents } from "./money";

describe("dollarsToCents", () => {
  it.each([
    ["10", 1000],
    ["172.5", 17250],
    ["172.50", 17250],
    ["0.07", 7],
    ["0", 0],
    ["0.0001", 0],
    ["172.345", 17235],
    ["172.3449", 17234],
    ["0.995", 100],
    ["229.9987", 23000],
    ["1234567.89", 123456789],
  ])("converts %s to %i cents", (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents);
  });

  it("ignores surrounding whitespace", () => {
    expect(dollarsToCents(" 12.34 ")).toBe(1234);
  });

  it.each(["", " ", "-1", "1e3", "abc", "1.2.3", ".5", "5.", "$5", "1,000"])("rejects %j", (input) => {
    expect(() => dollarsToCents(input)).toThrow(RangeError);
  });
});

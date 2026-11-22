import { describe, expect, it } from "vitest";
import { validateReport } from "./citation-check";

const sources = [
  { id: "src-10k", url: "https://www.sec.gov/Archives/edgar/data/320193/10k.htm" },
  { id: "src-form4", url: "https://www.sec.gov/Archives/edgar/data/320193/form4.xml" },
];

const validClaim = { text: "Revenue grew 8% year over year.", sourceIds: ["src-10k"] };

describe("validateReport", () => {
  describe("AC1: every claim cites at least one fetched source", () => {
    it("rejects a claim with no sources", () => {
      const report = {
        bull: [{ text: "Margins are expanding.", sourceIds: [] }],
        bear: [validClaim],
      };

      const result = validateReport(report, sources);

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.reason)).toEqual(["no-sources"]);
    });

    it("rejects a claim citing an id that was not fetched", () => {
      const report = {
        bull: [validClaim],
        bear: [{ text: "Insiders are selling.", sourceIds: ["src-made-up"] }],
      };

      const result = validateReport(report, sources);

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.reason)).toEqual(["unknown-source"]);
    });

    it("rejects a claim with one valid and one invalid id", () => {
      const report = {
        bull: [{ text: "Buybacks continue.", sourceIds: ["src-10k", "src-made-up"] }],
        bear: [validClaim],
      };

      const result = validateReport(report, sources);

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.reason)).toEqual(["unknown-source"]);
    });

    it("accepts claims whose sources were all fetched", () => {
      const report = {
        bull: [{ text: "Revenue grew and the CEO bought shares.", sourceIds: ["src-10k", "src-form4"] }],
        bear: [validClaim],
      };

      const result = validateReport(report, sources);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });
});

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

  describe("AC2: a report needs at least one bull claim and one bear claim", () => {
    it("rejects a report with no bull claims", () => {
      const result = validateReport({ bull: [], bear: [validClaim] }, sources);

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.reason)).toEqual(["empty-section"]);
    });

    it("rejects a report with no bear claims", () => {
      const result = validateReport({ bull: [validClaim], bear: [] }, sources);

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.reason)).toEqual(["empty-section"]);
    });

    it("reports both sections when both are empty", () => {
      const result = validateReport({ bull: [], bear: [] }, sources);

      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.reason)).toEqual(["empty-section", "empty-section"]);
    });
  });

  describe("AC3: each error names the section, the claim number and the reason", () => {
    it("names the section and the 1-based claim number for each bad claim", () => {
      const report = {
        bull: [validClaim, { text: "Guidance was raised.", sourceIds: [] }],
        bear: [
          validClaim,
          validClaim,
          { text: "A lawsuit is pending.", sourceIds: ["src-10k", "src-made-up"] },
        ],
      };

      const result = validateReport(report, sources);

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        { section: "bull", claim: 2, reason: "no-sources" },
        { section: "bear", claim: 3, reason: "unknown-source", sourceId: "src-made-up" },
      ]);
    });

    it("reports each unfetched id in a claim as its own error", () => {
      const report = {
        bull: [{ text: "Two fake citations.", sourceIds: ["fake-a", "fake-b"] }],
        bear: [validClaim],
      };

      const result = validateReport(report, sources);

      expect(result.errors).toEqual([
        { section: "bull", claim: 1, reason: "unknown-source", sourceId: "fake-a" },
        { section: "bull", claim: 1, reason: "unknown-source", sourceId: "fake-b" },
      ]);
    });

    it("names the empty section with no claim number", () => {
      const result = validateReport({ bull: [validClaim], bear: [] }, sources);

      expect(result.errors).toEqual([{ section: "bear", claim: null, reason: "empty-section" }]);
    });

    it("returns valid with no errors for a fully valid report", () => {
      const report = {
        bull: [validClaim, { text: "The CEO bought shares.", sourceIds: ["src-form4"] }],
        bear: [{ text: "Inventory is rising.", sourceIds: ["src-10k", "src-form4"] }],
      };

      expect(validateReport(report, sources)).toEqual({ valid: true, errors: [] });
    });
  });
});

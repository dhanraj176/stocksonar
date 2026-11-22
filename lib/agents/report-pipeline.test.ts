import { describe, expect, it, vi } from "vitest";
import { generateReport, type ReportPipelineDeps } from "./report-pipeline";

const sources = [
  { id: "src-10k", url: "https://www.sec.gov/Archives/edgar/data/320193/10k.htm" },
  { id: "src-form4", url: "https://www.sec.gov/Archives/edgar/data/320193/form4.xml" },
];

const validClaim = { text: "Revenue grew 8% year over year.", sourceIds: ["src-10k"] };

const validReport = {
  bull: [validClaim],
  bear: [{ text: "Insiders sold shares last quarter.", sourceIds: ["src-form4"] }],
};

function deps(overrides: Partial<ReportPipelineDeps> = {}) {
  return {
    fetchSources: vi.fn<ReportPipelineDeps["fetchSources"]>().mockResolvedValue(sources),
    writeReport: vi.fn<ReportPipelineDeps["writeReport"]>().mockResolvedValue(validReport),
    ...overrides,
  };
}

describe("generateReport", () => {
  describe("when nothing was fetched", () => {
    it("rejects with nothing-fetched", async () => {
      const pipeline = deps({ fetchSources: vi.fn().mockResolvedValue([]) });

      const result = await generateReport("AAPL", pipeline);

      expect(result).toEqual({ status: "rejected", errors: [{ reason: "nothing-fetched" }] });
    });

    it("does not ask the agent for a report", async () => {
      const pipeline = deps({ fetchSources: vi.fn().mockResolvedValue([]) });

      await generateReport("AAPL", pipeline);

      expect(pipeline.writeReport).not.toHaveBeenCalled();
    });
  });

  describe("when the agent returns malformed output", () => {
    it.each([
      ["null", null],
      ["a string", "Here is your report: AAPL looks great."],
      ["an array", [validClaim]],
      ["a report missing bear", { bull: [validClaim] }],
      ["a claim whose sourceIds is a string", { bull: [{ text: "Margins grew.", sourceIds: "src-10k" }], bear: [validClaim] }],
      ["a claim with empty text", { bull: [{ text: "", sourceIds: ["src-10k"] }], bear: [validClaim] }],
    ])("rejects %s as malformed-report", async (_label, output) => {
      const pipeline = deps({ writeReport: vi.fn().mockResolvedValue(output) });

      const result = await generateReport("AAPL", pipeline);

      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ reason: "malformed-report" });
      expect(result.errors[0]).toHaveProperty("issues", expect.arrayContaining([expect.any(String)]));
    });

    it("names the path of the bad field in issues", async () => {
      const output = { bull: [{ text: "", sourceIds: ["src-10k"] }], bear: [validClaim] };
      const pipeline = deps({ writeReport: vi.fn().mockResolvedValue(output) });

      const result = await generateReport("AAPL", pipeline);

      expect(result).toEqual({
        status: "rejected",
        errors: [{ reason: "malformed-report", issues: [expect.stringContaining("bull.0.text")] }],
      });
    });
  });

  describe("when the report fails the citation check", () => {
    it("rejects with the checker's errors for an unfetched source", async () => {
      const output = {
        bull: [validClaim],
        bear: [{ text: "A lawsuit is pending.", sourceIds: ["src-made-up"] }],
      };
      const pipeline = deps({ writeReport: vi.fn().mockResolvedValue(output) });

      const result = await generateReport("AAPL", pipeline);

      expect(result).toEqual({
        status: "rejected",
        errors: [{ section: "bear", claim: 1, reason: "unknown-source", sourceId: "src-made-up" }],
      });
    });

    it("rejects an empty bull section", async () => {
      const output = { bull: [], bear: [validClaim] };
      const pipeline = deps({ writeReport: vi.fn().mockResolvedValue(output) });

      const result = await generateReport("AAPL", pipeline);

      expect(result).toEqual({
        status: "rejected",
        errors: [{ section: "bull", claim: null, reason: "empty-section" }],
      });
    });

    it("never returns the rejected report", async () => {
      const output = { bull: [{ text: "Margins grew.", sourceIds: [] }], bear: [validClaim] };
      const pipeline = deps({ writeReport: vi.fn().mockResolvedValue(output) });

      const result = await generateReport("AAPL", pipeline);

      expect(result.status).toBe("rejected");
      expect(result).not.toHaveProperty("report");
    });
  });

  describe("when the report passes every check", () => {
    it("returns ok with the agent's report", async () => {
      const result = await generateReport("AAPL", deps());

      expect(result).toEqual({ status: "ok", report: validReport });
    });

    it("fetches for the ticker and gives the agent the fetched sources", async () => {
      const pipeline = deps();

      await generateReport("AAPL", pipeline);

      expect(pipeline.fetchSources).toHaveBeenCalledWith("AAPL");
      expect(pipeline.writeReport).toHaveBeenCalledWith("AAPL", sources);
    });

    it("strips fields the report type does not have", async () => {
      const output = {
        ...validReport,
        recommendation: "BUY",
        bull: [{ ...validClaim, confidence: "high" }],
      };
      const pipeline = deps({ writeReport: vi.fn().mockResolvedValue(output) });

      const result = await generateReport("AAPL", pipeline);

      expect(result).toStrictEqual({
        status: "ok",
        report: { bull: [validClaim], bear: validReport.bear },
      });
    });
  });
});

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
});

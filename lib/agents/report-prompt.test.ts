import { describe, expect, it } from "vitest";
import { buildReportPrompt } from "./report-prompt";

const tenK = { id: "edgar:0000320193-26-000026", url: "https://www.sec.gov/10k.htm", content: "Net sales rose 6%." };

describe("buildReportPrompt", () => {
  describe("output limits in the system prompt", () => {
    it("allows at most 5 claims per side", () => {
      expect(buildReportPrompt("AAPL", [tenK]).system).toMatch(/at most 5 claims per side/i);
    });

    it("asks for each claim to stay under 40 words", () => {
      expect(buildReportPrompt("AAPL", [tenK]).system).toMatch(/each claim under 40 words/i);
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildReportPrompt, PROMPT_BUDGET_CHARS, SYSTEM_PROMPT_BUDGET_CHARS, type ReportSource } from "./report-prompt";

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

/**
 * A realistic large prompt: the smoke script's sources for one ticker. 5 filings' metadata,
 * 5 Form 4 summaries, and one 10-K excerpt at the 4,000-character cap.
 */
function realisticSources(): ReportSource[] {
  const filings = ["10-K", "10-Q", "8-K", "8-K", "8-K"].map((form, index) => ({
    id: `edgar:0000320193-26-00002${index}`,
    url: `https://www.sec.gov/Archives/edgar/data/320193/00003201932600002${index}/aapl-20260926x${index}.htm`,
    title: `${form} filed 2026-11-0${index + 1}`,
    content: [
      `Form ${form}, filed 2026-11-0${index + 1}, accepted 2026-11-0${index + 1}T20:31:07.000Z.`,
      "Period of report: 2026-09-26.",
      `Description: ${form === "8-K" ? "Results of Operations and Financial Condition, Financial Statements and Exhibits" : "Annual or quarterly report"}.`,
    ].join("\n"),
  }));
  const tenKExcerpt = { ...filings[0], id: "edgar:0000320193-26-000099", content: "Net sales rose 6% on services growth. ".repeat(120) };
  const form4s = Array.from({ length: 5 }, (_, index) => ({
    id: `edgar:0001140361-26-04577${index}`,
    url: `https://www.sec.gov/Archives/edgar/data/320193/00011403612604577${index}/xslF345X06/form4.xml`,
    title: `Form 4 filed 2026-10-0${index + 1}`,
    content:
      "3 trades by 2 insiders (Jane Doe, Chief Financial Officer; Rajesh Kumar Patel, SVP, General Counsel), " +
      "2026-10-01 to 2026-10-02. Net shares: -150,512.25 (acquired 12,000, disposed 162,512.25). " +
      "Value of priced trades: $37,456,789.12; 1 unpriced. Codes: S×2, M×1, F×1.",
  }));
  return [...filings, tenKExcerpt, ...form4s];
}

describe("the prompt size budget", () => {
  it("keeps a realistic large prompt within PROMPT_BUDGET_CHARS", () => {
    const { system, user } = buildReportPrompt("AAPL", realisticSources());

    expect(system.length + user.length).toBeLessThanOrEqual(PROMPT_BUDGET_CHARS);
  });

  it("keeps the fixed system prompt within SYSTEM_PROMPT_BUDGET_CHARS", () => {
    expect(buildReportPrompt("AAPL", []).system.length).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_CHARS);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { logReportUsage, type ReportUsage } from "./report-usage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logReportUsage", () => {
  it("writes the usage as one JSON line through console.info", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const usage: ReportUsage = {
      event: "report-usage",
      provider: "gemini",
      model: "gemini-test-model",
      inputTokens: 2100,
      outputTokens: 450,
      reasoningTokens: 30,
      latencyMs: 250,
      outcome: "ok",
    };

    logReportUsage(usage);

    expect(info).toHaveBeenCalledTimes(1);
    const [line] = info.mock.calls[0];
    expect(typeof line).toBe("string");
    expect(line).not.toContain("\n");
    expect(JSON.parse(line as string)).toEqual(usage);
  });
});

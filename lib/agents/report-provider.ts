import "server-only";
import { getAnthropicClient, REPORT_MODEL } from "./claude";
import { getGeminiConfig } from "./gemini";
import { createOpenAiCompatWriter } from "./openai-compat-writer";
import { getClaudeReportWriter, type ReportWriter } from "./report-writer";
import { ReportWriterError } from "./report-writer-error";

export type ReportProvider = "gemini" | "claude";

/**
 * The report writer the app uses. REPORT_PROVIDER picks it on each call: gemini (the default,
 * paid from Google's developer credits) or claude. Switching needs only env changes.
 */
export function getReportWriter(): ReportWriter {
  return async (ticker, sources) => {
    if (readProvider() === "claude") return getClaudeReportWriter()(ticker, sources);
    const config = getGeminiConfig();
    return createOpenAiCompatWriter({ ...config, provider: "gemini" })(ticker, sources);
  };
}

/** Names the provider and model, or throws a config error, without sending anything. */
export function checkReportProvider(): { provider: ReportProvider; model: string } {
  if (readProvider() === "claude") {
    getAnthropicClient();
    return { provider: "claude", model: REPORT_MODEL };
  }
  return { provider: "gemini", model: getGeminiConfig().model };
}

function readProvider(): ReportProvider {
  const value = process.env.REPORT_PROVIDER?.trim().toLowerCase() || "gemini";
  if (value === "gemini" || value === "claude") return value;
  // The value isn't secret, but it's still not echoed.
  throw new ReportWriterError("config", "REPORT_PROVIDER must be gemini or claude (or unset for gemini).");
}

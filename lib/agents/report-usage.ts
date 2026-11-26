import type { ReportWriterErrorKind } from "./report-writer-error";

/** One line per model call. Never holds the prompt, the sources or the key. */
export type ReportUsage = {
  event: "report-usage";
  provider: string;
  model: string;
  /** null when the provider didn't say (an HTTP error, or no usage field). */
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number;
  /** ok, the ReportWriterError kind, or error for anything else (a network error). */
  outcome: "ok" | ReportWriterErrorKind | "error";
};

export type UsageLogger = (usage: ReportUsage) => void;

export function logReportUsage(usage: ReportUsage): void {
  void usage;
  throw new Error("not implemented");
}

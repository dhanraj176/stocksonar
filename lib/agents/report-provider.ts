import "server-only";
import type { ReportWriter } from "./report-writer";

export type ReportProvider = "gemini" | "claude";

export function getReportWriter(): ReportWriter {
  return async () => {
    throw new Error("not implemented");
  };
}

export function checkReportProvider(): { provider: ReportProvider; model: string } {
  throw new Error("not implemented");
}

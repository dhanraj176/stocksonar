import type { CitationError, FetchedSource, Report } from "@/lib/domain/citation-check";

export type ReportPipelineDeps = {
  fetchSources: (ticker: string) => Promise<FetchedSource[]>;
  /** Returns the agent's raw output. It is untrusted until parsed. */
  writeReport: (ticker: string, sources: FetchedSource[]) => Promise<unknown>;
};

export type PipelineError =
  | { reason: "nothing-fetched" }
  | { reason: "malformed-report"; issues: string[] }
  | CitationError;

export type PipelineResult =
  | { status: "ok"; report: Report }
  | { status: "rejected"; errors: PipelineError[] };

export async function generateReport(ticker: string, deps: ReportPipelineDeps): Promise<PipelineResult> {
  const sources = await deps.fetchSources(ticker);
  if (sources.length === 0) {
    return { status: "rejected", errors: [{ reason: "nothing-fetched" }] };
  }

  throw new Error("not implemented");
}

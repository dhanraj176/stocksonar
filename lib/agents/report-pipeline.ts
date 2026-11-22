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

// Stub so the red tests compile; replaced in the green step.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function generateReport(_ticker: string, _deps: ReportPipelineDeps): Promise<PipelineResult> {
  throw new Error("not implemented");
}

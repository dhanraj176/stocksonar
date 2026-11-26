import { z } from "zod";
import { validateReport, type CitationError, type FetchedSource, type Report } from "@/lib/domain/citation-check";
import { MAX_CLAIMS_PER_SIDE } from "./report-prompt";

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

const claimSchema = z.object({
  text: z.string().min(1),
  sourceIds: z.array(z.string()),
});

/**
 * Checks shape and the claim cap. Empty sections and empty sourceIds pass on purpose,
 * so validateReport can report them with their section and claim number.
 * Exported so the report writer asks the model for exactly this shape.
 */
export const reportSchema = z.object({
  bull: z.array(claimSchema).max(MAX_CLAIMS_PER_SIDE),
  bear: z.array(claimSchema).max(MAX_CLAIMS_PER_SIDE),
}) satisfies z.ZodType<Report>;

export async function generateReport(ticker: string, deps: ReportPipelineDeps): Promise<PipelineResult> {
  const sources = await deps.fetchSources(ticker);
  if (sources.length === 0) {
    return { status: "rejected", errors: [{ reason: "nothing-fetched" }] };
  }

  const raw = await deps.writeReport(ticker, sources);
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    return { status: "rejected", errors: [{ reason: "malformed-report", issues }] };
  }

  const check = validateReport(parsed.data, sources);
  if (!check.valid) {
    return { status: "rejected", errors: check.errors };
  }

  return { status: "ok", report: parsed.data };
}

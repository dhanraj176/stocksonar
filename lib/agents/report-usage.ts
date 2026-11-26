import { ReportWriterError, type ReportWriterErrorKind } from "./report-writer-error";

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

export type UsageTokens = Pick<ReportUsage, "inputTokens" | "outputTokens" | "reasoningTokens">;

export type UsageLogger = (usage: ReportUsage) => void;

export function logReportUsage(usage: ReportUsage): void {
  console.info(JSON.stringify(usage));
}

/**
 * Runs one model call and logs its usage once, whether it succeeds or throws. The call
 * reports tokens through `setTokens` as soon as it has them, so failures after a response
 * (a refusal, a cut-off answer) still log them. Errors are rethrown unchanged.
 */
export async function trackUsage<T>(
  context: { provider: string; model: string; now: () => number; log: UsageLogger },
  call: (setTokens: (tokens: UsageTokens) => void) => Promise<T>,
): Promise<T> {
  const started = context.now();
  let tokens: UsageTokens = { inputTokens: null, outputTokens: null, reasoningTokens: null };
  let outcome: ReportUsage["outcome"] = "ok";
  try {
    return await call((reported) => {
      tokens = reported;
    });
  } catch (error) {
    outcome = error instanceof ReportWriterError ? error.kind : "error";
    throw error;
  } finally {
    context.log({
      event: "report-usage",
      provider: context.provider,
      model: context.model,
      ...tokens,
      latencyMs: Math.round(context.now() - started),
      outcome,
    });
  }
}

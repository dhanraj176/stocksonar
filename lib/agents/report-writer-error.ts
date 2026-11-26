/** quota: a rate limit, a used-up quota or used-up credits. The app falls back to a cached report. */
export type ReportWriterErrorKind = "config" | "refusal" | "truncated" | "invalid-input" | "quota" | "api";

export class ReportWriterError extends Error {
  readonly kind: ReportWriterErrorKind;
  /** For refusals: the policy category the API gave, or null. */
  readonly category?: string | null;
  /** For quota and api errors: the HTTP status. */
  readonly status?: number;

  constructor(
    kind: ReportWriterErrorKind,
    message: string,
    details: { category?: string | null; status?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ReportWriterError";
    this.kind = kind;
    this.category = details.category;
    this.status = details.status;
  }
}

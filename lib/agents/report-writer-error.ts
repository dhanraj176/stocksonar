export type ReportWriterErrorKind = "config" | "refusal" | "truncated" | "invalid-input" | "api";

export class ReportWriterError extends Error {
  readonly kind: ReportWriterErrorKind;
  /** For refusals: the policy category the API gave, or null. */
  readonly category?: string | null;
  /** For api errors: the HTTP status. */
  readonly status?: number;

  constructor(
    kind: ReportWriterErrorKind,
    message: string,
    details: { category?: string | null; status?: number } = {},
  ) {
    super(message);
    this.name = "ReportWriterError";
    this.kind = kind;
    this.category = details.category;
    this.status = details.status;
  }
}

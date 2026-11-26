export type ReportWriterErrorKind = "config" | "refusal" | "truncated" | "invalid-input";

export class ReportWriterError extends Error {
  readonly kind: ReportWriterErrorKind;
  /** For refusals: the policy category the API gave, or null. */
  readonly category?: string | null;

  constructor(kind: ReportWriterErrorKind, message: string, details: { category?: string | null } = {}) {
    super(message);
    this.name = "ReportWriterError";
    this.kind = kind;
    this.category = details.category;
  }
}

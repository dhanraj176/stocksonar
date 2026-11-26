export type EdgarErrorKind = "http" | "invalid-response" | "config";

export class EdgarError extends Error {
  readonly kind: EdgarErrorKind;
  readonly status?: number;
  readonly url?: string;
  /** zod issues as "path: message" strings, for invalid-response errors. */
  readonly issues?: string[];

  constructor(kind: EdgarErrorKind, message: string, details: { status?: number; url?: string; issues?: string[] } = {}) {
    super(message);
    this.name = "EdgarError";
    this.kind = kind;
    this.status = details.status;
    this.url = details.url;
    this.issues = details.issues;
  }
}

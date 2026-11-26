import type { z } from "zod";

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

/** Validates SEC data with zod; a mismatch becomes an invalid-response EdgarError listing the issues. */
export function parseSecResponse<T>(schema: z.ZodType<T>, value: unknown, url: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    throw new EdgarError("invalid-response", `Unexpected SEC response shape: ${url}`, { url, issues });
  }
  return result.data;
}

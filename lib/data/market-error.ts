import type { z } from "zod";

export type MarketDataErrorKind = "http" | "rate-limited" | "invalid-response" | "config";

/** Messages and fields never hold the API key. */
export class MarketDataError extends Error {
  readonly kind: MarketDataErrorKind;
  readonly status?: number;
  readonly url?: string;
  /** zod issues as "path: message" strings, for invalid-response errors. */
  readonly issues?: string[];

  constructor(kind: MarketDataErrorKind, message: string, details: { status?: number; url?: string; issues?: string[] } = {}) {
    super(message);
    this.name = "MarketDataError";
    this.kind = kind;
    this.status = details.status;
    this.url = details.url;
    this.issues = details.issues;
  }
}

/** Validates Finnhub data with zod; a mismatch becomes an invalid-response MarketDataError listing the issues. */
export function parseMarketResponse<T>(schema: z.ZodType<T>, value: unknown, url: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    throw new MarketDataError("invalid-response", `Unexpected Finnhub response shape: ${url}`, { url, issues });
  }
  return result.data;
}

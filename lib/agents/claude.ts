import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ReportWriterError } from "./report-writer-error";

/** The one place the report model is named. */
export const REPORT_MODEL = "claude-sonnet-5-5";

let shared: { apiKey: string; client: Anthropic } | undefined;

/**
 * The process-wide Anthropic client, built from ANTHROPIC_API_KEY on first use (not at import,
 * so builds and tests need no key). "server-only" keeps this module, and the key, out of the browser.
 */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    // Never echo the value.
    throw new ReportWriterError("config", "ANTHROPIC_API_KEY must be set to write reports.");
  }
  if (shared?.apiKey !== apiKey) {
    shared = { apiKey, client: new Anthropic({ apiKey }) };
  }
  return shared.client;
}

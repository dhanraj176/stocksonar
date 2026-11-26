import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

/** The one place the report model is named. */
export const REPORT_MODEL = "claude-sonnet-5-5";

/** The process-wide Anthropic client, built from ANTHROPIC_API_KEY on first use. */
export function getAnthropicClient(): Anthropic {
  throw new Error("not implemented");
}

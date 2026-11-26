import { z } from "zod";
import { reportSchema } from "./report-pipeline";
import { buildReportPrompt } from "./report-prompt";
import type { ReportWriter } from "./report-writer";

/** The part of fetch the writer uses. The global fetch satisfies it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OpenAiCompatWriterDeps = {
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai/ */
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
};

/** 10 claims of under 40 words need roughly 600-900 tokens; the rest is headroom for minimal reasoning. */
const MAX_TOKENS = 2048;
const TIMEOUT_MS = 60_000;

/** Only the JSON schema is sent. The pipeline's reportSchema checks the answer, in one place. */
const REPORT_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(reportSchema);
  void $schema;
  return schema;
})();

/**
 * A report writer for any OpenAI-compatible chat completions endpoint (Gemini's by default).
 * Plain fetch, no SDK and no retries: a quota error should fall back at once, not spend more quota.
 */
export function createOpenAiCompatWriter(deps: OpenAiCompatWriterDeps): ReportWriter {
  const fetch = deps.fetch ?? globalThis.fetch;
  const url = `${deps.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return async (ticker, sources) => {
    const prompt = buildReportPrompt(ticker, sources);
    await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: deps.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "report", strict: true, schema: REPORT_JSON_SCHEMA } },
        max_tokens: MAX_TOKENS,
        // Gemini 3+ can't turn reasoning off; minimal keeps it cheap. temperature is ignored there, so it's not sent.
        reasoning_effort: "minimal",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return undefined;
  };
}

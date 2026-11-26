import { z } from "zod";
import { reportSchema } from "./report-pipeline";
import { buildReportPrompt } from "./report-prompt";
import { logReportUsage, trackUsage, type UsageLogger, type UsageTokens } from "./report-usage";
import type { ReportWriter } from "./report-writer";
import { ReportWriterError } from "./report-writer-error";

/** The part of fetch the writer uses. The global fetch satisfies it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OpenAiCompatWriterDeps = {
  /** e.g. https://generativelanguage.googleapis.com/v1beta/openai/ */
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  /** The provider name for the usage log. */
  provider?: string;
  /** Milliseconds, for latency. */
  now?: () => number;
  log?: UsageLogger;
};

/** 10 claims of under 40 words need roughly 600-900 tokens; the rest is headroom for low-effort reasoning. */
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
 * Plain fetch, no SDK and no retries: a quota or unavailable error should fall back at once, not spend more quota.
 */
export function createOpenAiCompatWriter(deps: OpenAiCompatWriterDeps): ReportWriter {
  const fetch = deps.fetch ?? globalThis.fetch;
  const url = `${deps.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const usage = {
    provider: deps.provider ?? "openai-compat",
    model: deps.model,
    now: deps.now ?? (() => performance.now()),
    log: deps.log ?? logReportUsage,
  };

  return async (ticker, sources) => {
    const prompt = buildReportPrompt(ticker, sources);
    return trackUsage(usage, async (setTokens) => {
      const response = await fetch(url, {
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
          // Gemini 3+ can't turn reasoning off, and 3.8 Flash rejects "minimal" (HTTP 400), so low is the
          // cheapest level. temperature is ignored there, so it's not sent.
          reasoning_effort: "low",
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw await httpError(response, deps.apiKey);

      const body: unknown = await response.json().catch(() => undefined);
      setTokens(readTokens(body));
      return readAnswer(body, response.status);
    });
  };
}

/** Loose on purpose: Gemini's exact fields aren't documented, so only what the writer reads is checked. */
const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
});

const usageSchema = z.object({
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
  }),
});

function readTokens(body: unknown): UsageTokens {
  const parsed = usageSchema.safeParse(body);
  if (!parsed.success) return { inputTokens: null, outputTokens: null, reasoningTokens: null };
  const { usage } = parsed.data;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
  };
}

/**
 * Returns the answer as untrusted data for the pipeline to check. Text that isn't JSON is
 * returned as is, so the pipeline rejects it as malformed-report with the rest.
 */
function readAnswer(body: unknown, status: number): unknown {
  const parsed = completionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ReportWriterError("api", "The provider sent an unexpected response shape.", { status });
  }

  const [{ message, finish_reason: finishReason }] = parsed.data.choices;
  if (finishReason === "content_filter") {
    throw new ReportWriterError("refusal", "The provider's content filter stopped the report.", { category: "content_filter" });
  }
  if (message.refusal) {
    throw new ReportWriterError("refusal", "The model declined to write the report.", { category: null });
  }
  if (finishReason === "length") {
    throw new ReportWriterError("truncated", "The report was cut off (length).");
  }

  const text = message.content;
  if (text === null || text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 429 is a rate or quota limit; 402 means prepaid credits are used up. */
const QUOTA_STATUSES = new Set([429, 402]);
/** Temporary overload ("high demand"). Like quota, the app falls back rather than retrying. */
const UNAVAILABLE_STATUS = 503;
const MAX_DETAIL_CHARS = 200;

/** Google's errors come as {error:{message}} or [{error:{message}}]. Anything else gives no detail. */
const errorBodySchema = z.union([
  z.object({ error: z.object({ message: z.string() }) }),
  z.tuple([z.object({ error: z.object({ message: z.string() }) })], z.unknown()),
]);

/** Decided by status alone. The provider's message is untrusted: capped, stripped of control characters, key redacted. */
async function httpError(response: Response, apiKey: string): Promise<ReportWriterError> {
  const body = errorBodySchema.safeParse(await response.json().catch(() => undefined));
  const message = body.success ? (Array.isArray(body.data) ? body.data[0] : body.data).error.message : "";
  const detail = Array.from((apiKey ? message.replaceAll(apiKey, "[redacted]") : message).replace(/[\u0000-\u001f\u007f-\u009f]/g, ""))
    .slice(0, MAX_DETAIL_CHARS)
    .join("");
  const suffix = detail ? `: ${detail}` : ".";

  if (response.status === UNAVAILABLE_STATUS) {
    return new ReportWriterError("unavailable", `The provider is temporarily unavailable (HTTP 503)${suffix}`, { status: 503 });
  }
  if (QUOTA_STATUSES.has(response.status)) {
    return new ReportWriterError("quota", `The provider's quota or rate limit was hit (HTTP ${response.status})${suffix}`, {
      status: response.status,
    });
  }
  return new ReportWriterError("api", `The provider returned HTTP ${response.status}${suffix}`, { status: response.status });
}

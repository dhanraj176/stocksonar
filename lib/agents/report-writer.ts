import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, REPORT_MODEL } from "./claude";
import { reportSchema } from "./report-pipeline";
import { buildReportPrompt, type ReportSource } from "./report-prompt";
import { logReportUsage, trackUsage, type UsageLogger } from "./report-usage";
import { ReportWriterError } from "./report-writer-error";

export type { ReportSource } from "./report-prompt";

/** The part of the Anthropic client the writer uses, so tests can pass a fake. */
export type ReportWriterClient = {
  messages: { create(params: MessageCreateParamsNonStreaming): Promise<Message> };
};

export type ReportWriter = (ticker: string, sources: ReportSource[]) => Promise<unknown>;

const MAX_TOKENS = 16000;

/** Only the JSON schema is sent. The pipeline's reportSchema checks the answer, in one place. */
const REPORT_FORMAT = { type: "json_schema", schema: zodOutputFormat(reportSchema).schema } as const;

export type ReportWriterDeps = {
  client: ReportWriterClient;
  model?: string;
  /** Milliseconds, for latency. */
  now?: () => number;
  log?: UsageLogger;
};

export function createReportWriter(deps: ReportWriterDeps): ReportWriter {
  const model = deps.model ?? REPORT_MODEL;
  const usage = { provider: "claude", model, now: deps.now ?? (() => performance.now()), log: deps.log ?? logReportUsage };
  return async (ticker, sources) => {
    const prompt = buildReportPrompt(ticker, sources);
    return trackUsage(usage, async (setTokens) => {
      const message = await deps.client.messages
        .create({
          model,
          max_tokens: MAX_TOKENS,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          output_config: { format: REPORT_FORMAT },
        })
        .catch((error: unknown) => {
          throw asQuotaError(error);
        });
      setTokens({
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        reasoningTokens: message.usage.output_tokens_details?.thinking_tokens ?? null,
      });
      return readAnswer(message);
    });
  };
}

/** A rate limit becomes quota, so the app can fall back to a cached report. Other errors pass through unchanged. */
function asQuotaError(error: unknown): unknown {
  if (error instanceof Anthropic.RateLimitError) {
    return new ReportWriterError("quota", "Claude's rate limit was hit (HTTP 429).", { status: 429, cause: error });
  }
  return error;
}

/**
 * Returns the answer as untrusted data for the pipeline to check. Text that isn't JSON is
 * returned as is, so the pipeline rejects it as malformed-report with the rest.
 */
function readAnswer(message: Message): unknown {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category ?? null;
    throw new ReportWriterError("refusal", `Claude declined to write the report (category: ${category ?? "none"}).`, { category });
  }
  if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
    throw new ReportWriterError("truncated", `The report was cut off (${message.stop_reason}).`);
  }

  const text = message.content.find((block) => block.type === "text")?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The Claude writer: the shared client, built from ANTHROPIC_API_KEY on each call's first use. */
export function getClaudeReportWriter(): ReportWriter {
  return async (ticker, sources) => createReportWriter({ client: getAnthropicClient() })(ticker, sources);
}

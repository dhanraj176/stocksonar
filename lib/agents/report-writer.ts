import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicClient, REPORT_MODEL } from "./claude";
import { reportSchema } from "./report-pipeline";
import { buildReportPrompt, type ReportSource } from "./report-prompt";
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

export function createReportWriter(deps: { client: ReportWriterClient; model?: string }): ReportWriter {
  const model = deps.model ?? REPORT_MODEL;
  return async (ticker, sources) => {
    const prompt = buildReportPrompt(ticker, sources);
    const message = await deps.client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: { format: REPORT_FORMAT },
    });
    return readAnswer(message);
  };
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

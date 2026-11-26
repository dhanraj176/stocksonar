import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { FetchedSource } from "@/lib/domain/citation-check";
import { REPORT_MODEL } from "./claude";
import { reportSchema } from "./report-pipeline";

/** A fetched source, with optional text for the model to read. */
export type ReportSource = FetchedSource & { title?: string; content?: string };

/** The part of the Anthropic client the writer uses, so tests can pass a fake. */
export type ReportWriterClient = {
  messages: { create(params: MessageCreateParamsNonStreaming): Promise<Message> };
};

export type ReportWriter = (ticker: string, sources: ReportSource[]) => Promise<unknown>;

const MAX_TOKENS = 16000;

/** Only the JSON schema is sent. The pipeline's reportSchema checks the answer, in one place. */
const REPORT_FORMAT = { type: "json_schema", schema: zodOutputFormat(reportSchema).schema } as const;

const SYSTEM_PROMPT = "You write a bull case and a bear case for one US stock.";

export function createReportWriter(deps: { client: ReportWriterClient; model?: string }): ReportWriter {
  const model = deps.model ?? REPORT_MODEL;
  return async (ticker, sources) => {
    const message = await deps.client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage(ticker, sources) }],
      output_config: { format: REPORT_FORMAT },
    });
    const text = message.content.find((block) => block.type === "text")?.text;
    return text === undefined ? undefined : JSON.parse(text);
  };
}

function userMessage(ticker: string, sources: ReportSource[]): string {
  return `Ticker: ${ticker}\n<sources>\n${sources.map(sourceBlock).join("\n")}\n</sources>`;
}

function sourceBlock(source: ReportSource): string {
  const lines = [`<source id="${source.id}" url="${source.url}">`];
  if (source.title !== undefined) lines.push(`<title>${source.title}</title>`);
  if (source.content !== undefined) lines.push(`<content>${source.content}</content>`);
  lines.push("</source>");
  return lines.join("\n");
}

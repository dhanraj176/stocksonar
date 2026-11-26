import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { FetchedSource } from "@/lib/domain/citation-check";

/** A fetched source, with optional text for the model to read. */
export type ReportSource = FetchedSource & { title?: string; content?: string };

/** The part of the Anthropic client the writer uses, so tests can pass a fake. */
export type ReportWriterClient = {
  messages: { create(params: MessageCreateParamsNonStreaming): Promise<Message> };
};

export type ReportWriter = (ticker: string, sources: ReportSource[]) => Promise<unknown>;

export function createReportWriter(deps: { client: ReportWriterClient; model?: string }): ReportWriter {
  void deps;
  return async () => {
    throw new Error("not implemented");
  };
}

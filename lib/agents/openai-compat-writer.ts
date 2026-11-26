import type { ReportWriter } from "./report-writer";

/** The part of fetch the writer uses. The global fetch satisfies it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OpenAiCompatWriterDeps = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
};

export function createOpenAiCompatWriter(deps: OpenAiCompatWriterDeps): ReportWriter {
  void deps;
  return async () => {
    throw new Error("not implemented");
  };
}

import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_MODEL } from "./claude";
import { createReportWriter, type ReportSource, type ReportWriterClient } from "./report-writer";

vi.mock("server-only", () => ({}));

const tenK: ReportSource = {
  id: "edgar:0000320193-26-000026",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm",
  title: "10-K filed 2026-11-03",
  content: "Net sales rose 6% year over year.",
};

const form4: ReportSource = {
  id: "edgar:0001140361-26-045775",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000114036126045775/xslF345X06/form4.xml",
};

const validReport = {
  bull: [{ text: "Net sales rose 6%.", sourceIds: [tenK.id] }],
  bear: [{ text: "An officer sold shares.", sourceIds: [form4.id] }],
};

/** A Message as the API returns it. Only stop_reason, stop_details and content vary in these tests. */
function apiMessage(overrides: Partial<Pick<Message, "content" | "stop_reason" | "stop_details">> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: REPORT_MODEL,
    content: [{ type: "text", text: JSON.stringify(validReport), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    },
    ...overrides,
  };
}

function fakeClient(message: Message = apiMessage()) {
  const create = vi.fn<ReportWriterClient["messages"]["create"]>().mockResolvedValue(message);
  return { client: { messages: { create } }, create };
}

/** The single request the writer sent. */
function sentRequest(create: ReturnType<typeof fakeClient>["create"]): MessageCreateParamsNonStreaming {
  expect(create).toHaveBeenCalledTimes(1);
  return create.mock.calls[0][0];
}

function userText(request: MessageCreateParamsNonStreaming): string {
  expect(request.messages).toHaveLength(1);
  const [message] = request.messages;
  expect(message.role).toBe("user");
  expect(typeof message.content).toBe("string");
  return message.content as string;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Unit tests must not use the network");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createReportWriter", () => {
  describe("the request", () => {
    it("uses the report model by default", async () => {
      const { client, create } = fakeClient();

      await createReportWriter({ client })("AAPL", [tenK]);

      expect(sentRequest(create).model).toBe(REPORT_MODEL);
    });

    it("uses the model it was given", async () => {
      const { client, create } = fakeClient();

      await createReportWriter({ client, model: "claude-test-model" })("AAPL", [tenK]);

      expect(sentRequest(create).model).toBe("claude-test-model");
    });

    it("asks for JSON matching the report schema", async () => {
      const { client, create } = fakeClient();

      await createReportWriter({ client })("AAPL", [tenK]);

      const format = sentRequest(create).output_config?.format;
      expect(format?.type).toBe("json_schema");
      expect(format?.schema).toMatchObject({
        type: "object",
        properties: { bull: { type: "array" }, bear: { type: "array" } },
        required: expect.arrayContaining(["bull", "bear"]),
      });
    });

    it("leaves room for the answer and sends no temperature", async () => {
      const { client, create } = fakeClient();

      await createReportWriter({ client })("AAPL", [tenK]);

      const request = sentRequest(create);
      expect(request.max_tokens).toBe(16000);
      expect(request).not.toHaveProperty("temperature");
      expect(request).not.toHaveProperty("stream", true);
    });

    it("sends one user message with the ticker and every source id and url inside <sources>", async () => {
      const { client, create } = fakeClient();

      await createReportWriter({ client })("AAPL", [tenK, form4]);

      const text = userText(sentRequest(create));
      expect(text).toMatch(/^Ticker: AAPL\n/);
      const sourcesBlock = text.slice(text.indexOf("<sources>"), text.indexOf("</sources>") + "</sources>".length);
      expect(sourcesBlock).not.toBe("");
      for (const source of [tenK, form4]) {
        expect(sourcesBlock).toContain(`<source id="${source.id}" url="${source.url}">`);
      }
      expect(sourcesBlock).toContain("<title>10-K filed 2026-11-03</title>");
      expect(sourcesBlock).toContain("<content>Net sales rose 6% year over year.</content>");
    });

    it("accepts a source with no title or content", async () => {
      const { client, create } = fakeClient();

      await createReportWriter({ client })("AAPL", [form4]);

      const text = userText(sentRequest(create));
      const start = text.indexOf(`<source id="${form4.id}"`);
      const block = text.slice(start, text.indexOf("</source>", start));
      expect(block).not.toContain("<title>");
      expect(block).not.toContain("<content>");
    });
  });
});

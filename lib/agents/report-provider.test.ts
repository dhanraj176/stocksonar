import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_MODEL } from "./claude";
import { GEMINI_DEFAULT_MODEL } from "./gemini";
import type { ReportSource } from "./report-prompt";

vi.mock("server-only", () => ({}));

const tenK: ReportSource = {
  id: "edgar:0000320193-26-000026",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm",
  content: "Net sales rose 6% year over year.",
};
const validReport = { bull: [{ text: "Net sales rose 6%.", sourceIds: [tenK.id] }], bear: [{ text: "Thin.", sourceIds: [tenK.id] }] };

const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const geminiAnswer = () =>
  json({ choices: [{ message: { content: JSON.stringify(validReport) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

const claudeAnswer = () =>
  json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: REPORT_MODEL,
    content: [{ type: "text", text: JSON.stringify(validReport) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });

/** A fresh copy of the modules, so env is read fresh and the memoized Claude client starts empty. */
async function loadProvider() {
  vi.resetModules();
  const provider = await import("./report-provider");
  const { ReportWriterError } = await import("./report-writer-error");
  return { ...provider, ReportWriterError };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => {
    throw new Error("Unit tests must not use the network");
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("REPORT_PROVIDER", undefined);
  vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
  vi.stubEnv("GEMINI_MODEL", undefined);
  vi.stubEnv("GEMINI_BASE_URL", undefined);
  vi.stubEnv("ANTHROPIC_API_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getReportWriter", () => {
  it("imports and returns a writer with no env set", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);

    const { getReportWriter } = await loadProvider();

    expect(() => getReportWriter()).not.toThrow();
  });

  it.each([
    ["unset", undefined],
    ["blank", "  "],
    ["gemini", "gemini"],
    ["Gemini, with spaces", " Gemini "],
  ])("sends the report to Gemini when REPORT_PROVIDER is %s", async (_label, value) => {
    vi.stubEnv("REPORT_PROVIDER", value);
    fetchMock.mockImplementation(async () => geminiAnswer());
    const { getReportWriter } = await loadProvider();

    await expect(getReportWriter()("AAPL", [tenK])).resolves.toEqual(validReport);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gemini-test-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: GEMINI_DEFAULT_MODEL });
  });

  it("logs usage under the gemini provider", async () => {
    fetchMock.mockImplementation(async () => geminiAnswer());
    const info = vi.mocked(console.info);
    const { getReportWriter } = await loadProvider();

    await getReportWriter()("AAPL", [tenK]);

    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({ provider: "gemini", model: GEMINI_DEFAULT_MODEL });
  });

  it("sends the report to Claude when REPORT_PROVIDER is claude", async () => {
    vi.stubEnv("REPORT_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    fetchMock.mockImplementation(async () => claudeAnswer());
    const { getReportWriter } = await loadProvider();

    await expect(getReportWriter()("AAPL", [tenK])).resolves.toEqual(validReport);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.anthropic.com/v1/messages");
  });

  it("rejects with a config error naming REPORT_PROVIDER for an unknown provider, sending nothing", async () => {
    vi.stubEnv("REPORT_PROVIDER", "openai");
    const { getReportWriter, ReportWriterError } = await loadProvider();

    const error = await getReportWriter()("AAPL", [tenK]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReportWriterError);
    expect(error).toMatchObject({ kind: "config" });
    expect((error as Error).message).toContain("REPORT_PROVIDER");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with a config error when Gemini has no key, sending nothing", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    const { getReportWriter, ReportWriterError } = await loadProvider();

    const error = await getReportWriter()("AAPL", [tenK]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ReportWriterError);
    expect(error).toMatchObject({ kind: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads env on each call, so switching needs no restart of the module", async () => {
    fetchMock.mockImplementation(async () => geminiAnswer());
    const { getReportWriter } = await loadProvider();
    const write = getReportWriter();

    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-pro");
    await write("AAPL", [tenK]);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: "gemini-3.8-pro" });
  });
});

describe("checkReportProvider", () => {
  it("names the Gemini provider and model by default", async () => {
    const { checkReportProvider } = await loadProvider();

    expect(checkReportProvider()).toEqual({ provider: "gemini", model: GEMINI_DEFAULT_MODEL });
  });

  it("names Claude and its model when chosen", async () => {
    vi.stubEnv("REPORT_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    const { checkReportProvider } = await loadProvider();

    expect(checkReportProvider()).toEqual({ provider: "claude", model: REPORT_MODEL });
  });

  it.each([
    ["Gemini has no key", { GEMINI_API_KEY: undefined }],
    ["Claude has no key", { REPORT_PROVIDER: "claude" }],
    ["the provider is unknown", { REPORT_PROVIDER: "llama" }],
  ])("throws a config error, sending nothing, when %s", async (_label, env: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const { checkReportProvider, ReportWriterError } = await loadProvider();

    expect(() => checkReportProvider()).toThrow(ReportWriterError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

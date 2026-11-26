import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn(() => {
  throw new Error("Unit tests must not use the network");
});

/** A fresh copy of the module, so the memoized client starts empty. */
async function loadClaude() {
  vi.resetModules();
  const claude = await import("./claude");
  const { ReportWriterError } = await import("./report-writer-error");
  return { ...claude, ReportWriterError };
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getAnthropicClient", () => {
  it("does not read the key at import", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);

    await expect(loadClaude()).resolves.toBeDefined();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "  \t "],
  ])("throws a config error naming ANTHROPIC_API_KEY when it is %s", async (_label, value) => {
    vi.stubEnv("ANTHROPIC_API_KEY", value);
    const { getAnthropicClient, ReportWriterError } = await loadClaude();

    const error = (() => {
      try {
        getAnthropicClient();
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(ReportWriterError);
    expect(error).toMatchObject({ kind: "config", message: expect.stringContaining("ANTHROPIC_API_KEY") });
  });

  it("builds a client with the key, without making a request", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    const { getAnthropicClient } = await loadClaude();

    const client = getAnthropicClient();

    expect(client.apiKey).toBe("sk-ant-test-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the same client on every call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
    const { getAnthropicClient } = await loadClaude();

    expect(getAnthropicClient()).toBe(getAnthropicClient());
  });

  it("builds a new client when the key changes", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-first");
    const { getAnthropicClient } = await loadClaude();
    const first = getAnthropicClient();

    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-second");
    const second = getAnthropicClient();

    expect(second).not.toBe(first);
    expect(second.apiKey).toBe("sk-ant-second");
  });
});

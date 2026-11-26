import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GEMINI_DEFAULT_BASE_URL, GEMINI_DEFAULT_MODEL, getGeminiConfig } from "./gemini";
import { ReportWriterError } from "./report-writer-error";

vi.mock("server-only", () => ({}));

const KEY = "gemini-test-key-not-real";

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", KEY);
  vi.stubEnv("GEMINI_MODEL", undefined);
  vi.stubEnv("GEMINI_BASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configError(): unknown {
  try {
    getGeminiConfig();
  } catch (error) {
    return error;
  }
  throw new Error("expected getGeminiConfig to throw");
}

describe("getGeminiConfig", () => {
  it("does not read env at import", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    vi.resetModules();

    await expect(import("./gemini")).resolves.toBeDefined();
  });

  it("uses Google's OpenAI-compatible endpoint and gemini-3.5-flash-lite by default", () => {
    expect(GEMINI_DEFAULT_MODEL).toBe("gemini-3.5-flash-lite");
    expect(GEMINI_DEFAULT_BASE_URL).toBe("https://generativelanguage.googleapis.com/v1beta/openai/");
    expect(getGeminiConfig()).toEqual({ apiKey: KEY, model: GEMINI_DEFAULT_MODEL, baseUrl: GEMINI_DEFAULT_BASE_URL });
  });

  it("trims the key", () => {
    vi.stubEnv("GEMINI_API_KEY", `  ${KEY}\n`);

    expect(getGeminiConfig().apiKey).toBe(KEY);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "  \t "],
  ])("throws a config error naming GEMINI_API_KEY when it is %s", (_label, value) => {
    vi.stubEnv("GEMINI_API_KEY", value);

    const error = configError();

    expect(error).toBeInstanceOf(ReportWriterError);
    expect(error).toMatchObject({ kind: "config" });
    expect((error as Error).message).toContain("GEMINI_API_KEY");
  });

  it("reads the model from GEMINI_MODEL", () => {
    vi.stubEnv("GEMINI_MODEL", " gemini-3.8-flash ");

    expect(getGeminiConfig().model).toBe("gemini-3.8-flash");
  });

  it("uses the default model when GEMINI_MODEL is blank", () => {
    vi.stubEnv("GEMINI_MODEL", "  ");

    expect(getGeminiConfig().model).toBe(GEMINI_DEFAULT_MODEL);
  });

  it("reads the base URL from GEMINI_BASE_URL", () => {
    vi.stubEnv("GEMINI_BASE_URL", "https://proxy.example.test/openai/");

    expect(getGeminiConfig().baseUrl).toBe("https://proxy.example.test/openai/");
  });

  it.each([
    ["plain http", "http://proxy.example.test/openai/"],
    ["not a URL", "generativelanguage.googleapis.com"],
  ])("throws a config error for a GEMINI_BASE_URL that is %s", (_label, value) => {
    vi.stubEnv("GEMINI_BASE_URL", value);

    const error = configError();

    expect(error).toBeInstanceOf(ReportWriterError);
    expect(error).toMatchObject({ kind: "config" });
    expect((error as Error).message).toContain("GEMINI_BASE_URL");
  });

  it("never echoes the key in a config error", () => {
    vi.stubEnv("GEMINI_BASE_URL", "ftp://nope");

    expect((configError() as Error).message).not.toContain(KEY);
  });
});

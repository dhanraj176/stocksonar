import { afterEach, describe, expect, it, vi } from "vitest";
import { publicEnv } from "./env";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicEnv", () => {
  it("returns the Supabase URL and publishable key when both are set", () => {
    vi.stubEnv(URL_VAR, "https://abc.supabase.co");
    vi.stubEnv(KEY_VAR, "sb_publishable_test");

    expect(publicEnv()).toEqual({
      url: "https://abc.supabase.co",
      publishableKey: "sb_publishable_test",
    });
  });

  it("throws naming the URL variable when it is missing", () => {
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(KEY_VAR, "sb_publishable_test");

    expect(() => publicEnv()).toThrow(URL_VAR);
  });

  it("throws naming the URL variable when it is not a URL", () => {
    vi.stubEnv(URL_VAR, "abc.supabase");
    vi.stubEnv(KEY_VAR, "sb_publishable_test");

    expect(() => publicEnv()).toThrow(URL_VAR);
  });

  it("throws naming the key variable when it is missing", () => {
    vi.stubEnv(URL_VAR, "https://abc.supabase.co");
    vi.stubEnv(KEY_VAR, "");

    expect(() => publicEnv()).toThrow(KEY_VAR);
  });

  it("names the bad variable without echoing any value", () => {
    vi.stubEnv(URL_VAR, "not a url");
    vi.stubEnv(KEY_VAR, "sb_publishable_test");

    const message = (() => {
      try {
        publicEnv();
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();

    expect(message).toContain(URL_VAR);
    expect(message).not.toContain("not a url");
    expect(message).not.toContain("sb_publishable_test");
  });
});

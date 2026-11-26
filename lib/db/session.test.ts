import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "./session";

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void;
};

// What the fake getClaims() should do: optionally write refreshed cookies, then
// return claims for a signed-in user or null for a signed-out one.
const fake = vi.hoisted(() => ({
  claims: null as null | { sub: string },
  refreshedCookies: [] as CookieToSet[],
  cacheHeaders: {} as Record<string, string>,
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: fake.createServerClient,
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  fake.claims = null;
  fake.refreshedCookies = [];
  fake.cacheHeaders = {};
  fake.createServerClient.mockImplementation(
    (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
      auth: {
        getClaims: async () => {
          if (fake.refreshedCookies.length > 0) {
            options.cookies.setAll(fake.refreshedCookies, fake.cacheHeaders);
          }
          return fake.claims
            ? { data: { claims: fake.claims }, error: null }
            : { data: null, error: null };
        },
      },
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

describe("updateSession", () => {
  it("redirects a signed-out user on a protected path to /login with next", async () => {
    const response = await updateSession(request("/dashboard?tab=1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard%3Ftab%3D1",
    );
  });

  it("lets a signed-in user through to a protected path", async () => {
    fake.claims = { sub: "user-a" };

    const response = await updateSession(request("/dashboard"));

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a signed-in user away from /login to /dashboard", async () => {
    fake.claims = { sub: "user-a" };

    const response = await updateSession(request("/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("reads the request cookies through getAll", async () => {
    fake.claims = { sub: "user-a" };
    let seen: { name: string; value: string }[] = [];
    fake.createServerClient.mockImplementationOnce(
      (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
        auth: {
          getClaims: async () => {
            seen = options.cookies.getAll();
            return { data: { claims: fake.claims }, error: null };
          },
        },
      }),
    );

    await updateSession(request("/dashboard", "sb-abc-auth-token=old"));

    expect(seen).toEqual([{ name: "sb-abc-auth-token", value: "old" }]);
  });

  it("puts refreshed cookies and cache headers on a pass-through response", async () => {
    fake.claims = { sub: "user-a" };
    fake.refreshedCookies = [{ name: "sb-abc-auth-token", value: "new", options: { path: "/" } }];
    fake.cacheHeaders = { "Cache-Control": "private, no-store" };

    const response = await updateSession(request("/dashboard", "sb-abc-auth-token=old"));

    expect(response.cookies.get("sb-abc-auth-token")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps every cookie batch and the cache headers when setAll runs twice", async () => {
    // @supabase/ssr sends the cache headers only with its first write.
    fake.createServerClient.mockImplementationOnce(
      (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
        auth: {
          getClaims: async () => {
            options.cookies.setAll(
              [{ name: "sb-abc-auth-token.0", value: "first", options: {} }],
              { "Cache-Control": "private, no-store" },
            );
            options.cookies.setAll([{ name: "sb-abc-auth-token.1", value: "second", options: {} }], {});
            return { data: { claims: { sub: "user-a" } }, error: null };
          },
        },
      }),
    );

    const response = await updateSession(request("/dashboard"));

    expect(response.cookies.get("sb-abc-auth-token.0")?.value).toBe("first");
    expect(response.cookies.get("sb-abc-auth-token.1")?.value).toBe("second");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps refreshed cookies and cache headers on a redirect", async () => {
    fake.claims = null;
    fake.refreshedCookies = [{ name: "sb-abc-auth-token", value: "", options: { maxAge: 0 } }];
    fake.cacheHeaders = { "Cache-Control": "private, no-store" };

    const response = await updateSession(request("/dashboard", "sb-abc-auth-token=stale"));

    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-abc-auth-token")?.value).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

import { describe, expect, it } from "vitest";
import { authRedirect, isPublicPath, safeNextPath } from "./auth-redirect";

describe("isPublicPath", () => {
  it.each(["/", "/login", "/signup"])("treats %s as public", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each(["/dashboard", "/dashboard/x", "/loginx", "/signup/extra"])(
    "treats %s as protected",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(false);
    },
  );
});

describe("safeNextPath", () => {
  it("keeps a same-site path with its query string", () => {
    expect(safeNextPath("/dashboard?tab=1")).toBe("/dashboard?tab=1");
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash host", "/\\evil.com"],
    ["an absolute URL", "https://evil.com"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "dashboard"],
    ["a tab that browsers strip into //", "/\t/evil.com"],
    ["a newline that browsers strip into //", "/\n/evil.com"],
  ])("falls back to /dashboard for %s", (_label, next) => {
    expect(safeNextPath(next)).toBe("/dashboard");
  });
});

describe("authRedirect", () => {
  it("sends a signed-out user on a protected path to /login with next", () => {
    expect(
      authRedirect({ pathname: "/dashboard", search: "?x=1", signedIn: false }),
    ).toBe("/login?next=%2Fdashboard%3Fx%3D1");
  });

  it("lets a signed-out user stay on /login", () => {
    expect(authRedirect({ pathname: "/login", search: "", signedIn: false })).toBeNull();
  });

  it("lets a signed-out user see the landing page", () => {
    expect(authRedirect({ pathname: "/", search: "", signedIn: false })).toBeNull();
  });

  it.each(["/login", "/signup"])("sends a signed-in user on %s to /dashboard", (pathname) => {
    expect(authRedirect({ pathname, search: "", signedIn: true })).toBe("/dashboard");
  });

  it("lets a signed-in user stay on a protected path", () => {
    expect(authRedirect({ pathname: "/dashboard", search: "", signedIn: true })).toBeNull();
  });
});

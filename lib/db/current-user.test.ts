import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "./current-user";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("./server", () => ({
  createServerSupabase: async () => ({ auth: { getClaims: fake.getClaims } }),
}));

vi.mock("next/navigation", () => ({ redirect: fake.redirect }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUser", () => {
  it("returns the id and email of the signed-in user", async () => {
    fake.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-a", email: "a@example.com" } },
      error: null,
    });

    await expect(requireUser()).resolves.toEqual({ id: "user-a", email: "a@example.com" });
  });

  it("redirects to /login when there is no session", async () => {
    fake.getClaims.mockResolvedValue({ data: null, error: null });

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(fake.redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when the JWT fails verification", async () => {
    fake.getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") });

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

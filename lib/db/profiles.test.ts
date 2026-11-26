import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMyProfile } from "./profiles";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  requireUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("./current-user", () => ({ requireUser: fake.requireUser }));
vi.mock("./server", () => ({
  createServerSupabase: async () => ({ from: fake.from }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fake.requireUser.mockResolvedValue({ id: "user-a", email: "a@example.com" });
  fake.from.mockReturnValue({ select: fake.select });
  fake.select.mockReturnValue({ eq: fake.eq });
  fake.eq.mockReturnValue({ maybeSingle: fake.maybeSingle });
});

describe("getMyProfile", () => {
  it("reads the signed-in user's own profile row", async () => {
    fake.maybeSingle.mockResolvedValue({ data: { display_name: "Ada" }, error: null });

    await expect(getMyProfile()).resolves.toEqual({ displayName: "Ada" });
    expect(fake.from).toHaveBeenCalledWith("profiles");
    expect(fake.select).toHaveBeenCalledWith("display_name");
    expect(fake.eq).toHaveBeenCalledWith("id", "user-a");
  });

  it("returns null when the user has no profile row", async () => {
    fake.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(getMyProfile()).resolves.toBeNull();
  });

  it("throws when the query fails so the error boundary shows it", async () => {
    fake.maybeSingle.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(getMyProfile()).rejects.toThrow("Could not load your profile");
  });

  it("does not query when there is no signed-in user", async () => {
    fake.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(getMyProfile()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(fake.from).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { logIn, logOut, signUp } from "./actions";

const fake = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => ({
    auth: {
      signUp: fake.signUp,
      signInWithPassword: fake.signInWithPassword,
      signOut: fake.signOut,
    },
  }),
}));

vi.mock("next/navigation", () => ({ redirect: fake.redirect }));

function form(fields: Record<string, string>) {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.set(key, value));
  return data;
}

const session = { access_token: "token" };

beforeEach(() => {
  vi.clearAllMocks();
  fake.signUp.mockResolvedValue({ data: { user: { id: "user-a" }, session }, error: null });
  fake.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
  fake.signOut.mockResolvedValue({ error: null });
});

describe("signUp", () => {
  it("rejects an invalid email without calling Supabase", async () => {
    const result = await signUp(undefined, form({ email: "not-an-email", password: "longenough" }));

    expect(result).toEqual({ error: "Enter a valid email address." });
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters without calling Supabase", async () => {
    const result = await signUp(undefined, form({ email: "a@example.com", password: "short" }));

    expect(result).toEqual({ error: "Password must be at least 8 characters." });
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("rejects a display name longer than 50 characters", async () => {
    const result = await signUp(
      undefined,
      form({ email: "a@example.com", password: "longenough", display_name: "x".repeat(51) }),
    );

    expect(result).toEqual({ error: "Display name must be 50 characters or fewer." });
    expect(fake.signUp).not.toHaveBeenCalled();
  });

  it("passes the trimmed display name as user metadata", async () => {
    await expect(
      signUp(
        undefined,
        form({ email: "a@example.com", password: "longenough", display_name: "  Ada  " }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(fake.signUp).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "longenough",
      options: { data: { display_name: "Ada" } },
    });
  });

  it("sends no display name when the field is blank", async () => {
    await expect(
      signUp(undefined, form({ email: "a@example.com", password: "longenough", display_name: "  " })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(fake.signUp).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "longenough",
      options: { data: {} },
    });
  });

  it("redirects to /dashboard after signing up", async () => {
    await expect(
      signUp(undefined, form({ email: "a@example.com", password: "longenough" })),
    ).rejects.toThrow("NEXT_REDIRECT /dashboard");
  });

  it("returns a generic error when Supabase rejects the sign-up", async () => {
    fake.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });

    const result = await signUp(undefined, form({ email: "a@example.com", password: "longenough" }));

    expect(result).toEqual({ error: "Could not create the account. Try again or log in." });
    expect(fake.redirect).not.toHaveBeenCalled();
  });

  it("asks the user to confirm their email when Supabase returns no session", async () => {
    fake.signUp.mockResolvedValue({ data: { user: { id: "user-a" }, session: null }, error: null });

    const result = await signUp(undefined, form({ email: "a@example.com", password: "longenough" }));

    expect(result).toEqual({ error: "Check your email to confirm your account, then log in." });
    expect(fake.redirect).not.toHaveBeenCalled();
  });
});

describe("logIn", () => {
  it("returns the generic message when the credentials are wrong", async () => {
    fake.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    const result = await logIn(undefined, form({ email: "a@example.com", password: "wrongpass" }));

    expect(result).toEqual({ error: "Email or password is incorrect." });
  });

  it("returns the generic message for a malformed email without calling Supabase", async () => {
    const result = await logIn(undefined, form({ email: "nope", password: "whatever1" }));

    expect(result).toEqual({ error: "Email or password is incorrect." });
    expect(fake.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in with the submitted email and password", async () => {
    await expect(
      logIn(undefined, form({ email: "a@example.com", password: "longenough" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: "a@example.com",
      password: "longenough",
    });
  });

  it("redirects to a same-site next path after logging in", async () => {
    await expect(
      logIn(
        undefined,
        form({ email: "a@example.com", password: "longenough", next: "/dashboard?tab=1" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /dashboard?tab=1");
  });

  it("ignores an off-site next path and redirects to /dashboard", async () => {
    await expect(
      logIn(undefined, form({ email: "a@example.com", password: "longenough", next: "//evil.com" })),
    ).rejects.toThrow("NEXT_REDIRECT /dashboard");

    expect(fake.redirect).toHaveBeenCalledWith("/dashboard");
  });
});

describe("logOut", () => {
  it("signs out and redirects to /login", async () => {
    await expect(logOut()).rejects.toThrow("NEXT_REDIRECT /login");

    expect(fake.signOut).toHaveBeenCalled();
  });
});

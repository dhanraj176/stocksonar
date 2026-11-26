import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabase } from "./admin";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({ createClient: vi.fn(() => ({ kind: "admin-client" })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createAdminSupabase", () => {
  it("creates a client with the service role key and no stored session", () => {
    createAdminSupabase();

    expect(fake.createClient).toHaveBeenCalledWith("https://abc.supabase.co", "service-role-test", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });

  it("throws naming SUPABASE_SERVICE_ROLE_KEY when it is missing", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    expect(() => createAdminSupabase()).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    expect(fake.createClient).not.toHaveBeenCalled();
  });
});

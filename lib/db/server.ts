import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "./env";

// Supabase client for server components, server actions and route handlers.
// It acts as the signed-in user, so Row Level Security applies.
export async function createServerSupabase() {
  const { url, publishableKey } = publicEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components can't set cookies. proxy.ts refreshes the
          // session on every request, so it is safe to ignore here.
        }
      },
    },
  });
}

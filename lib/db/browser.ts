import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "./env";

// Supabase client for client components. Uses only the public URL and
// publishable key; Row Level Security limits what it can read.
export function createBrowserSupabase() {
  const { url, publishableKey } = publicEnv();
  return createBrowserClient(url, publishableKey);
}

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv } from "./env";

const serviceRoleKeySchema = z.string().min(1);

// The only place SUPABASE_SERVICE_ROLE_KEY is read. This client bypasses Row
// Level Security, so use it only for trusted server-side jobs, never with
// input a user controls. "server-only" makes the build fail if a client
// component imports this file.
export function createAdminSupabase() {
  const { url } = publicEnv();
  const serviceRoleKey = serviceRoleKeySchema.safeParse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceRoleKey.success) {
    throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY. See .env.example.");
  }

  return createClient(url, serviceRoleKey.data, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

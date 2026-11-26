import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabase } from "./server";

export type CurrentUser = { id: string; email: string | null };

// Data Access Layer check. Every protected page and server action calls this,
// so access never depends on proxy.ts alone.
export async function requireUser(): Promise<CurrentUser> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/login");
  }

  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

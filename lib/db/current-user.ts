import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabase } from "./server";

export type CurrentUser = { id: string; email: string | null };

// Data Access Layer check. Every protected page and server action calls this,
// so access never depends on proxy.ts alone.
//
// "use cache: private": getClaims() compares the token's exp with Date.now().
// With partial prefetching, the route's App Shell is prerendered with the
// session cookies available, and Cache Components rejects Date.now() there.
// A private cache scope reads cookies directly and keeps the result in the
// browser only, never on the server (bundled docs:
// 02-guides/authentication-with-cache-components.md, Step 1). redirect()
// throws, so only a resolved user is cached.
export async function requireUser(): Promise<CurrentUser> {
  "use cache: private";

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/login");
  }

  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

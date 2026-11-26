import "server-only";
import { requireUser } from "./current-user";
import { createServerSupabase } from "./server";

export type Profile = { displayName: string | null };

// The signed-in user's own profile, read through RLS.
//
// "use cache: private" for the same reason as requireUser(): the Supabase
// client checks the access token's expiry with Date.now() before querying,
// which Cache Components rejects while prerendering the route's App Shell.
// The result is cached in the browser only, scoped to this session.
export async function getMyProfile(): Promise<Profile | null> {
  "use cache: private";

  const user = await requireUser();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error("Could not load your profile.");
  return data ? { displayName: data.display_name } : null;
}

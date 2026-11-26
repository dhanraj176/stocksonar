import type { Metadata } from "next";
import { Suspense } from "react";
import { logOut } from "@/app/(auth)/actions";
import { requireUser } from "@/lib/db/current-user";
import { createServerSupabase } from "@/lib/db/server";

export const metadata: Metadata = { title: "Dashboard · StockSonar" };

export default function DashboardPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {/* Reads the session cookie, so it streams in behind Suspense. */}
      <Suspense fallback={<p className="text-sm">Loading your account…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}

async function Account() {
  const user = await requireUser();
  const supabase = await createServerSupabase();
  // Goes through RLS as the signed-in user, so only their own row can come back.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const name = profile?.display_name ?? user.email ?? "there";

  return (
    <section className="flex flex-col items-start gap-4">
      <p>Signed in as {name}.</p>
      <form action={logOut}>
        <button type="submit" className="rounded-md border border-black/15 px-4 py-2 dark:border-white/20">
          Log out
        </button>
      </form>
    </section>
  );
}

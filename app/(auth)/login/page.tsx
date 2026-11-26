import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in · StockSonar" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Log in</h1>
      {/* The form reads ?next= with useSearchParams, so it sits behind Suspense. */}
      <Suspense fallback={<p className="text-sm">Loading…</p>}>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign up · StockSonar" };

export default function SignUpPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <Suspense fallback={<p className="text-sm">Loading…</p>}>
        <AuthForm mode="signup" />
      </Suspense>
    </main>
  );
}

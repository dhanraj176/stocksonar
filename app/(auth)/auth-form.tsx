"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { logIn, signUp, type AuthFormState } from "./actions";

type AuthFormProps = { mode: "login" | "signup" };

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20";

export function AuthForm({ mode }: AuthFormProps) {
  const isSignUp = mode === "signup";
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    isSignUp ? signUp : logIn,
    undefined,
  );
  // Passed through to the action, which only redirects to same-site paths.
  const next = useSearchParams().get("next") ?? "";

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      {isSignUp && (
        <label className="flex flex-col gap-1 text-sm">
          Display name (optional)
          <input name="display_name" maxLength={50} autoComplete="nickname" className={inputClass} />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={isSignUp ? 8 : undefined}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          className={inputClass}
        />
      </label>

      <p aria-live="polite" className="min-h-5 text-sm text-red-600 dark:text-red-400">
        {state?.error}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-4 py-2 font-medium text-background disabled:opacity-60"
      >
        {pending ? "Please wait…" : isSignUp ? "Create account" : "Log in"}
      </button>

      <p className="text-sm">
        {isSignUp ? "Already have an account? " : "New to StockSonar? "}
        <Link href={isSignUp ? "/login" : "/signup"} className="underline">
          {isSignUp ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}

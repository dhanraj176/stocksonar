"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/db/server";
import { safeNextPath } from "@/lib/domain/auth-redirect";

export type AuthFormState = { error: string } | undefined;

const LOGIN_FAILED = "Email or password is incorrect.";
const SIGNUP_FAILED = "Could not create the account. Try again or log in.";
const CONFIRM_EMAIL = "Check your email to confirm your account, then log in.";

const signUpSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(8, { error: "Password must be at least 8 characters." }),
  displayName: z.string().max(50, { error: "Display name must be 50 characters or fewer." }),
});

const logInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signUp(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: field(formData, "email").trim(),
    password: field(formData, "password"),
    displayName: field(formData, "display_name").trim(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { email, password, displayName } = parsed.data;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // The on_auth_user_created trigger copies display_name into public.profiles.
    options: { data: displayName ? { display_name: displayName } : {} },
  });

  if (error) return { error: SIGNUP_FAILED };
  if (!data.session) return { error: CONFIRM_EMAIL };

  redirect("/dashboard");
}

export async function logIn(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = logInSchema.safeParse({
    email: field(formData, "email").trim(),
    password: field(formData, "password"),
  });
  if (!parsed.success) return { error: LOGIN_FAILED };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: LOGIN_FAILED };

  redirect(safeNextPath(field(formData, "next") || null));
}

export async function logOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

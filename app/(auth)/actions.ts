"use server";

export type AuthFormState = { error: string } | undefined;

export async function signUp(_state: AuthFormState, _formData: FormData): Promise<AuthFormState> {
  throw new Error("not implemented");
}

export async function logIn(_state: AuthFormState, _formData: FormData): Promise<AuthFormState> {
  throw new Error("not implemented");
}

export async function logOut(): Promise<void> {
  throw new Error("not implemented");
}

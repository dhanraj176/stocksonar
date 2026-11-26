import "server-only";

export type CurrentUser = { id: string; email: string | null };

export async function requireUser(): Promise<CurrentUser> {
  throw new Error("not implemented");
}

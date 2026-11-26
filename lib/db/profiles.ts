import "server-only";

export type Profile = { displayName: string | null };

export async function getMyProfile(): Promise<Profile | null> {
  throw new Error("not implemented");
}

export type PublicEnv = {
  url: string;
  publishableKey: string;
};

export function publicEnv(): PublicEnv {
  throw new Error("not implemented");
}

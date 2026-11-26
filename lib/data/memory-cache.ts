/** Async so a Supabase-backed cache can implement it later without changing callers. */
export type Cache = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
};

export function createMemoryCache(options: { now?: () => number } = {}): Cache {
  throw new Error(`createMemoryCache is not implemented (${typeof options})`);
}

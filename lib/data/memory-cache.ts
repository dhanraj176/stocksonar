/** Async so a Supabase-backed cache can implement it later without changing callers. */
export type Cache = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
};

type Entry = { value: unknown; expiresAt: number };

export function createMemoryCache(options: { now?: () => number } = {}): Cache {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() >= entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlMs) {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
  };
}

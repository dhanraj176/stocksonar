import { describe, expect, it } from "vitest";
import { createMemoryCache } from "./memory-cache";

function clock(start = 1_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("createMemoryCache", () => {
  it("returns undefined for a key that was never set", async () => {
    const cache = createMemoryCache({ now: clock().now });

    expect(await cache.get("missing")).toBeUndefined();
  });

  it("returns a stored value until its TTL runs out", async () => {
    const time = clock();
    const cache = createMemoryCache({ now: time.now });
    await cache.set("edgar:tickers", { AAPL: "0000320193" }, 100);

    time.advance(99);
    expect(await cache.get("edgar:tickers")).toEqual({ AAPL: "0000320193" });

    time.advance(1);
    expect(await cache.get("edgar:tickers")).toBeUndefined();
  });

  it("keeps each key's value and TTL separate", async () => {
    const time = clock();
    const cache = createMemoryCache({ now: time.now });
    await cache.set("a", 1, 50);
    await cache.set("b", 2, 500);

    time.advance(100);

    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(2);
  });

  it("replaces a value and its TTL when a key is set again", async () => {
    const time = clock();
    const cache = createMemoryCache({ now: time.now });
    await cache.set("a", "old", 10);
    await cache.set("a", "new", 1_000);

    time.advance(500);

    expect(await cache.get("a")).toBe("new");
  });

  it("can store falsy values", async () => {
    const cache = createMemoryCache({ now: clock().now });
    await cache.set("zero", 0, 100);
    await cache.set("null", null, 100);

    expect(await cache.get("zero")).toBe(0);
    expect(await cache.get("null")).toBeNull();
  });
});

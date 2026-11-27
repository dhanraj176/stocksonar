import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteMyPosition, listMyPositions, upsertMyPosition } from "./positions";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  requireUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  upsert: vi.fn(),
  single: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("./current-user", () => ({ requireUser: fake.requireUser }));
vi.mock("./server", () => ({
  createServerSupabase: async () => ({ from: fake.from }),
}));

const COLUMNS =
  "id, user_id, ticker, quantity::text, cost_basis_cents, source, created_at, updated_at";

const row = {
  id: "0b9f3a52-6c1e-4f0a-8d3e-2a7c5e9b1d44",
  user_id: "5d2e8c7a-1b34-4c6f-9a0d-3e8f7b6a2c11",
  ticker: "AAPL",
  quantity: "0.123456",
  cost_basis_cents: 12345,
  source: "csv",
  created_at: "2026-11-27T03:39:28.123456+00:00",
  updated_at: "2026-11-27T03:39:28.123456+00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.requireUser.mockResolvedValue({ id: "user-a", email: "a@example.com" });
  fake.from.mockReturnValue({
    select: fake.select,
    upsert: fake.upsert,
    delete: fake.delete,
  });
  fake.select.mockReturnValue({ eq: fake.eq });
  fake.eq.mockReturnValue({ order: fake.order, eq: fake.eq });
  fake.upsert.mockReturnValue({ select: fake.select });
  fake.delete.mockReturnValue({ eq: fake.eq });
});

describe("listMyPositions", () => {
  it("selects explicit columns for the user, ordered by ticker, quantity still a string", async () => {
    fake.order.mockResolvedValue({ data: [row], error: null });

    await expect(listMyPositions()).resolves.toEqual([row]);
    expect(fake.from).toHaveBeenCalledWith("positions");
    expect(fake.select).toHaveBeenCalledWith(COLUMNS);
    expect(fake.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(fake.order).toHaveBeenCalledWith("ticker");
  });

  it("throws a friendly error when the query fails", async () => {
    fake.order.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    await expect(listMyPositions()).rejects.toThrow("Could not load your positions.");
  });

  it("throws when a row fails the schema", async () => {
    fake.order.mockResolvedValue({ data: [{ ...row, quantity: 0.123456 }], error: null });

    await expect(listMyPositions()).rejects.toThrow();
  });

  it("does not query when there is no signed-in user", async () => {
    fake.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(listMyPositions()).rejects.toThrow("NEXT_REDIRECT /login");
    expect(fake.from).not.toHaveBeenCalled();
  });
});

describe("upsertMyPosition", () => {
  const input = { ticker: " brk.b ", quantity: "2.5", costBasisCents: 5000, source: "manual" } as const;

  it("sends a snake_case payload with user_id from the session, even if the input smuggles one", async () => {
    fake.single.mockResolvedValue({ data: { ...row, ticker: "BRK.B" }, error: null });
    fake.select.mockReturnValue({ single: fake.single });

    const smuggled = { ...input, user_id: "user-b" };
    await expect(upsertMyPosition(smuggled)).resolves.toMatchObject({ ticker: "BRK.B" });

    expect(fake.from).toHaveBeenCalledWith("positions");
    expect(fake.upsert).toHaveBeenCalledWith(
      {
        user_id: "user-a",
        ticker: "BRK.B",
        quantity: "2.5",
        cost_basis_cents: 5000,
        source: "manual",
      },
      { onConflict: "user_id,ticker" },
    );
    expect(fake.select).toHaveBeenCalledWith(COLUMNS);
  });

  it("throws before any query when the input is invalid", async () => {
    await expect(upsertMyPosition({ ...input, quantity: "0" })).rejects.toThrow();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("turns a database error into a friendly one", async () => {
    fake.single.mockResolvedValue({ data: null, error: { message: "boom" } });
    fake.select.mockReturnValue({ single: fake.single });

    await expect(upsertMyPosition(input)).rejects.toThrow("Could not save your position.");
  });
});

describe("deleteMyPosition", () => {
  it("deletes by user and normalised ticker", async () => {
    fake.eq.mockReturnValueOnce({ eq: fake.eq }).mockResolvedValueOnce({ error: null });

    await expect(deleteMyPosition(" brk.b ")).resolves.toBeUndefined();
    expect(fake.from).toHaveBeenCalledWith("positions");
    expect(fake.delete).toHaveBeenCalled();
    expect(fake.eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(fake.eq).toHaveBeenNthCalledWith(2, "ticker", "BRK.B");
  });

  it("never queries for an invalid ticker", async () => {
    await expect(deleteMyPosition("1ABC")).rejects.toThrow();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("turns a database error into a friendly one", async () => {
    fake.eq.mockReturnValueOnce({ eq: fake.eq }).mockResolvedValueOnce({ error: { message: "boom" } });

    await expect(deleteMyPosition("AAPL")).rejects.toThrow("Could not delete your position.");
  });
});

import "server-only";
import {
  positionInputSchema,
  positionRowSchema,
  tickerSchema,
  type PositionInput,
  type PositionRow,
} from "@/lib/domain/positions";
import { requireUser } from "./current-user";
import { createServerSupabase } from "./server";

// quantity is numeric(18,6); ::text keeps it an exact decimal string.
const COLUMNS =
  "id, user_id, ticker, quantity::text, cost_basis_cents, source, created_at, updated_at";

// The signed-in user's positions, read through RLS (and filtered by user_id too).
export async function listMyPositions(): Promise<PositionRow[]> {
  const user = await requireUser();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("positions")
    .select(COLUMNS)
    .eq("user_id", user.id)
    .order("ticker");

  if (error) throw new Error("Could not load your positions.", { cause: error });
  return (data ?? []).map((row) => positionRowSchema.parse(row));
}

// Inserts the position, or replaces the user's existing row for that ticker.
export async function upsertMyPosition(input: PositionInput): Promise<PositionRow> {
  const parsed = positionInputSchema.parse(input);
  const user = await requireUser();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("positions")
    .upsert(
      {
        user_id: user.id,
        ticker: parsed.ticker,
        quantity: parsed.quantity,
        cost_basis_cents: parsed.costBasisCents,
        source: parsed.source,
      },
      { onConflict: "user_id,ticker" },
    )
    .select(COLUMNS)
    .single();

  if (error) throw new Error("Could not save your position.", { cause: error });
  return positionRowSchema.parse(data);
}

export async function deleteMyPosition(ticker: string): Promise<void> {
  const normalised = tickerSchema.parse(ticker);
  const user = await requireUser();
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("positions")
    .delete()
    .eq("user_id", user.id)
    .eq("ticker", normalised);

  if (error) throw new Error("Could not delete your position.", { cause: error });
}

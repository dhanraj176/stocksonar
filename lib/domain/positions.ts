import { z } from "zod";

export const POSITION_SOURCES = ["csv", "screenshot", "manual", "brokerage"] as const;

export const sourceSchema = z.enum(POSITION_SOURCES);

// Same rule as the database check, after trimming and uppercasing.
export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/);

// A positive decimal string, never a JS number: the column is numeric(18,6).
// Up to 12 whole digits and 6 decimals; more decimals are rejected, not rounded.
export const quantitySchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/)
  .refine((value) => /[1-9]/.test(value), { message: "Quantity must be greater than zero" });

// Integer cents, the TOTAL cost of the position (not per share). z.int() only
// accepts safe integers.
export const costBasisCentsSchema = z.int().nonnegative();

// What the app writes (camelCase).
export const positionInputSchema = z.object({
  ticker: tickerSchema,
  quantity: quantitySchema,
  costBasisCents: costBasisCentsSchema,
  source: sourceSchema,
});

export type PositionInput = z.infer<typeof positionInputSchema>;

// Exactly what the database returns (snake_case). PostgREST sends timestamps
// with a +00:00 offset, and quantity must be selected as quantity::text.
export const positionRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  ticker: tickerSchema,
  quantity: quantitySchema,
  cost_basis_cents: costBasisCentsSchema,
  source: sourceSchema,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type PositionRow = z.infer<typeof positionRowSchema>;

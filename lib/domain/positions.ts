import { z } from "zod";

export const POSITION_SOURCES = ["csv", "screenshot", "manual", "brokerage"] as const;

export const sourceSchema = z.enum(POSITION_SOURCES);

// Same rule as the database check, after trimming and uppercasing.
export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,9}$/);

// A decimal string, never a JS number: the column is numeric(18,6).
export const quantitySchema = z.string();

// Integer cents, the TOTAL cost of the position (not per share).
export const costBasisCentsSchema = z.int();

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

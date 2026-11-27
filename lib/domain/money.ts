const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Converts a non-negative decimal dollar string ("172.345") to integer cents,
 * rounding half-up on the third decimal. Works on the digits, never on floats.
 * Throws RangeError for anything else: signs, exponents, separators, blanks.
 */
export function dollarsToCents(dollars: string): number {
  const match = PLAIN_DECIMAL.exec(dollars.trim());
  if (!match) {
    throw new RangeError(`Not a plain non-negative decimal: ${JSON.stringify(dollars)}`);
  }

  const [, whole, fraction = ""] = match;
  const digits = fraction.padEnd(3, "0");
  const roundUp = digits[2] >= "5" ? 1 : 0;
  const cents = Number(whole) * 100 + Number(digits.slice(0, 2)) + roundUp;

  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Amount too large: ${JSON.stringify(dollars)}`);
  }
  return cents;
}

/**
 * Converts a JSON-number dollar amount (172.345) to integer cents. The shortest round-trip
 * string of the number goes through dollarsToCents, so no float math touches the cents.
 */
export function numberToCents(dollars: number): number {
  return dollarsToCents(String(dollars));
}

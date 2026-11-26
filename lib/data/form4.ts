import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { dollarsToCents } from "@/lib/domain/money";
import type { Filing } from "./edgar";
import { EdgarError, parseSecResponse } from "./edgar-error";

export type InsiderOwner = {
  name: string;
  cik: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  officerTitle: string | null;
};

export type InsiderTrade = {
  /** The Form 4 this trade came from, citable by id. */
  source: Filing;
  owners: InsiderOwner[];
  securityTitle: string;
  /** YYYY-MM-DD */
  date: string;
  /** SEC transaction code (P, S, A, M, F, G, ...). Alert rules decide which ones matter. */
  code: string;
  acquiredOrDisposed: "A" | "D";
  /** Can be fractional. */
  shares: number;
  /** null when the filing gives no price, or gives it only in a footnote. */
  priceCents: number | null;
  sharesOwnedAfter: number | null;
};

/**
 * Values stay strings (CIKs keep leading zeros, numbers are never floats until we choose).
 * The parser rejects external entities, which matters because filings are untrusted input.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "reportingOwner" || name === "nonDerivativeTransaction",
});

/** An empty element parses to "", which means "not given". */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

const text = z.string().trim();
const cik = text.regex(/^\d{1,10}$/);
const decimal = text.regex(/^\d+(\.\d+)?$/);
const flag = optional(z.enum(["0", "1", "true", "false"])).transform((value) => value === "1" || value === "true");
/** <x><value>…</value><footnoteId/></x>, where the value may be missing (footnote only) or the element absent. */
const optionalValue = <T extends z.ZodType>(schema: T) => optional(z.object({ value: optional(schema) }));

const ownerSchema = z.object({
  reportingOwnerId: z.object({ rptOwnerCik: cik, rptOwnerName: text.min(1) }),
  reportingOwnerRelationship: z.object({
    isDirector: flag,
    isOfficer: flag,
    isTenPercentOwner: flag,
    officerTitle: optional(text),
  }),
});

const transactionSchema = z.object({
  securityTitle: z.object({ value: text.min(1) }),
  transactionDate: z.object({ value: text.regex(/^\d{4}-\d{2}-\d{2}/) }),
  transactionCoding: z.object({ transactionCode: text.regex(/^[A-Z]$/) }),
  transactionAmounts: z.object({
    transactionShares: z.object({ value: decimal }),
    transactionPricePerShare: optionalValue(decimal),
    transactionAcquiredDisposedCode: z.object({ value: z.enum(["A", "D"]) }),
  }),
  postTransactionAmounts: optional(z.object({ sharesOwnedFollowingTransaction: optionalValue(decimal) })),
});

/** Only what the stories need. The derivative table, holdings, footnotes and remarks are left out. */
const form4Schema = z.object({
  ownershipDocument: z.object({
    documentType: z.literal("4"),
    issuer: z.object({ issuerCik: cik }),
    reportingOwner: z.array(ownerSchema).min(1),
    nonDerivativeTable: optional(z.object({ nonDerivativeTransaction: z.array(transactionSchema).optional() })),
  }),
});

/** Parses one Form 4. Throws an invalid-response EdgarError if it isn't a Form 4 for `issuerCik`. */
export function parseForm4(xml: string, context: { source: Filing; issuerCik: string }): InsiderTrade[] {
  const url = context.source.url;
  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch (error) {
    throw new EdgarError("invalid-response", `Form 4 is not parseable XML: ${url}`, {
      url,
      issues: [error instanceof Error ? error.message : String(error)],
    });
  }

  const document = parseSecResponse(form4Schema, raw, url).ownershipDocument;
  if (document.issuer.issuerCik.padStart(10, "0") !== context.issuerCik.padStart(10, "0")) {
    throw new EdgarError("invalid-response", `Form 4 issuer ${document.issuer.issuerCik} is not ${context.issuerCik}: ${url}`, {
      url,
    });
  }

  const owners: InsiderOwner[] = document.reportingOwner.map((owner) => ({
    name: owner.reportingOwnerId.rptOwnerName,
    cik: owner.reportingOwnerId.rptOwnerCik.padStart(10, "0"),
    isDirector: owner.reportingOwnerRelationship.isDirector,
    isOfficer: owner.reportingOwnerRelationship.isOfficer,
    isTenPercentOwner: owner.reportingOwnerRelationship.isTenPercentOwner,
    officerTitle: owner.reportingOwnerRelationship.officerTitle ?? null,
  }));

  const transactions = document.nonDerivativeTable?.nonDerivativeTransaction ?? [];
  return transactions.map((transaction) => {
    const amounts = transaction.transactionAmounts;
    const price = amounts.transactionPricePerShare?.value;
    const ownedAfter = transaction.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value;
    return {
      source: context.source,
      owners,
      securityTitle: transaction.securityTitle.value,
      date: transaction.transactionDate.value.slice(0, 10),
      code: transaction.transactionCoding.transactionCode,
      acquiredOrDisposed: amounts.transactionAcquiredDisposedCode.value,
      shares: Number(amounts.transactionShares.value),
      priceCents: price === undefined ? null : dollarsToCents(price),
      sharesOwnedAfter: ownedAfter === undefined ? null : Number(ownedAfter),
    };
  });
}

import { describe, expect, it } from "vitest";
import type { Filing } from "./edgar";
import { readFixture } from "./fixtures/edgar/fixtures";
import { parseForm4 } from "./form4";

const APPLE = "0000320193";

const saleSource: Filing = {
  id: "edgar:0001140361-26-045775",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000114036126045775/xslF345X06/form4.xml",
  accessionNumber: "0001140361-26-045775",
  form: "4",
  filingDate: "2026-11-25",
  reportDate: "2026-11-24",
  acceptedAt: "2026-11-25T23:30:25.000Z",
  description: "FORM 4",
};

const saleXml = readFixture("form4-sale.xml");
const awardXml = readFixture("form4-award.xml");

function parseSale(xml: string) {
  return parseForm4(xml, { source: saleSource, issuerCik: APPLE });
}

describe("parseForm4", () => {
  it("reads an open-market sale: who, what, when, how many, at what price, and what they hold after", () => {
    expect(parseSale(saleXml)).toEqual([
      {
        source: saleSource,
        owners: [
          {
            name: "Newstead Jennifer",
            cik: "0001780525",
            isDirector: false,
            isOfficer: true,
            isTenPercentOwner: false,
            officerTitle: "SVP, GC and Government Affairs",
          },
        ],
        securityTitle: "Common Stock",
        date: "2026-11-24",
        code: "S",
        acquiredOrDisposed: "D",
        shares: 2398,
        priceCents: 34756,
        sharesOwnedAfter: 22802,
      },
    ]);
  });

  it("reads every non-derivative row of an award filing and ignores the derivative table", () => {
    const trades = parseForm4(awardXml, { source: saleSource, issuerCik: APPLE });

    expect(trades.map((t) => [t.date, t.code, t.acquiredOrDisposed, t.shares, t.priceCents, t.sharesOwnedAfter])).toEqual([
      ["2026-10-15", "M", "A", 1714, null, 40451],
      ["2026-10-15", "F", "D", 883, 34200, 39568],
      ["2026-10-16", "S", "D", 151, 34308, 39417],
      ["2026-10-16", "S", "D", 80, 34418, 39337],
      ["2026-10-16", "S", "D", 969, 34574, 38368],
      ["2026-10-16", "S", "D", 40, 34622, 38328],
      ["2026-10-16", "S", "D", 40, 34743, 38288],
    ]);
    expect(new Set(trades.map((t) => t.securityTitle))).toEqual(new Set(["Common Stock"]));
    expect(trades[0].owners).toEqual([
      {
        name: "Borders Ben",
        cik: "0002100523",
        isDirector: false,
        isOfficer: true,
        isTenPercentOwner: false,
        officerTitle: "Principal Accounting Officer",
      },
    ]);
  });

  it("accepts 1/0 relationship flags and turns an empty officer title into null", () => {
    const xml = saleXml
      .replace("<isDirector>false</isDirector>", "<isDirector>1</isDirector>")
      .replace("<isOfficer>true</isOfficer>", "<isOfficer>0</isOfficer>")
      .replace("<officerTitle>SVP, GC and Government Affairs</officerTitle>", "<officerTitle></officerTitle>");

    expect(parseSale(xml)[0].owners[0]).toMatchObject({ isDirector: true, isOfficer: false, officerTitle: null });
  });

  it("lists every reporting owner of a joint filing", () => {
    const owner = saleXml.slice(saleXml.indexOf("<reportingOwner>"), saleXml.indexOf("</reportingOwner>") + "</reportingOwner>".length);
    const second = owner.replace("0001780525", "0000000042").replace("Newstead Jennifer", "Example Trust");
    const xml = saleXml.replace(owner, owner + second);

    expect(parseSale(xml)[0].owners.map((o) => [o.cik, o.name])).toEqual([
      ["0001780525", "Newstead Jennifer"],
      ["0000000042", "Example Trust"],
    ]);
  });

  it("allows fractional shares and a missing holdings-after value", () => {
    const xml = saleXml
      .replace("<value>2398</value>", "<value>2398.5</value>")
      .replace("<value>22802</value>", "");

    expect(parseSale(xml)[0]).toMatchObject({ shares: 2398.5, sharesOwnedAfter: null });
  });

  it.each([
    ["without a non-derivative table", (xml: string) => xml.replace(/<nonDerivativeTable>[\s\S]*<\/nonDerivativeTable>/, "")],
    ["with an empty non-derivative table", (xml: string) => xml.replace(/<nonDerivativeTable>[\s\S]*<\/nonDerivativeTable>/, "<nonDerivativeTable></nonDerivativeTable>")],
  ])("returns no trades for a filing %s", (_, edit) => {
    expect(parseSale(edit(saleXml))).toEqual([]);
  });

  it("decodes XML entities in names", () => {
    const xml = saleXml.replace("Newstead Jennifer", "Smith &amp; Jones LLC");

    expect(parseSale(xml)[0].owners[0].name).toBe("Smith & Jones LLC");
  });

  it.each([
    ["the issuer is a different company", saleXml, "0000789019"],
    ["a transaction has no date", saleXml.replace(/<transactionDate>[\s\S]*?<\/transactionDate>/, ""), APPLE],
    ["the transaction code is not a letter", saleXml.replace("<transactionCode>S</transactionCode>", "<transactionCode>SELL ALL</transactionCode>"), APPLE],
    ["the share count is not a number", saleXml.replace("<value>2398</value>", "<value>lots</value>"), APPLE],
    ["the price is not a plain decimal", saleXml.replace("<value>347.56</value>", "<value>-347.56</value>"), APPLE],
    ["it is an amendment, not a Form 4", saleXml.replace("<documentType>4</documentType>", "<documentType>4/A</documentType>"), APPLE],
    ["it has no reporting owner", saleXml.replace(/<reportingOwner>[\s\S]*<\/reportingOwner>/, ""), APPLE],
    ["it is not XML", "<html><body>Too Many Requests</body></html>", APPLE],
    ["it declares an external entity", saleXml.replace('<?xml version="1.0"?>', '<?xml version="1.0"?><!DOCTYPE ownershipDocument [<!ENTITY x SYSTEM "file:///etc/passwd">]>').replace("Newstead Jennifer", "&x;"), APPLE],
  ])("throws invalid-response when %s", (_, xml, issuerCik) => {
    expect(() => parseForm4(xml, { source: saleSource, issuerCik })).toThrow(
      expect.objectContaining({ name: "EdgarError", kind: "invalid-response", url: saleSource.url }),
    );
  });
});

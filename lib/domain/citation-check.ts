export type Claim = { text: string; sourceIds: string[] };
export type Report = { bull: Claim[]; bear: Claim[] };
export type FetchedSource = { id: string; url: string };
export type Section = keyof Report;
export type CitationError = {
  section: Section;
  /** 1-based claim number; null for errors about the whole section. */
  claim: number | null;
  reason: "no-sources" | "unknown-source" | "empty-section";
  /** Set only for "unknown-source": the cited id that was not fetched. */
  sourceId?: string;
};
export type ValidationResult = { valid: boolean; errors: CitationError[] };

const SECTIONS: readonly Section[] = ["bull", "bear"];

export function validateReport(report: Report, fetchedSources: FetchedSource[]): ValidationResult {
  const fetchedIds = new Set(fetchedSources.map((source) => source.id));
  const errors = SECTIONS.flatMap((section) => checkSection(section, report[section], fetchedIds));
  return { valid: errors.length === 0, errors };
}

function checkSection(section: Section, claims: Claim[], fetchedIds: Set<string>): CitationError[] {
  if (claims.length === 0) {
    return [{ section, claim: null, reason: "empty-section" }];
  }

  return claims.flatMap((claim, index): CitationError[] => {
    const number = index + 1;
    if (claim.sourceIds.length === 0) {
      return [{ section, claim: number, reason: "no-sources" }];
    }
    return claim.sourceIds
      .filter((id) => !fetchedIds.has(id))
      .map((id) => ({ section, claim: number, reason: "unknown-source", sourceId: id }));
  });
}

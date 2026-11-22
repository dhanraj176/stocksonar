export type Claim = { text: string; sourceIds: string[] };
export type Report = { bull: Claim[]; bear: Claim[] };
export type FetchedSource = { id: string; url: string };
export type CitationError = {
  section: "bull" | "bear";
  claim: number | null;
  reason: "no-sources" | "unknown-source" | "empty-section";
  sourceId?: string;
};
export type ValidationResult = { valid: boolean; errors: CitationError[] };

export function validateReport(report: Report, fetchedSources: FetchedSource[]): ValidationResult {
  const fetchedIds = new Set(fetchedSources.map((source) => source.id));
  const errors: CitationError[] = [];

  if (report.bull.length === 0) {
    errors.push({ section: "bull", claim: null, reason: "empty-section" });
  }
  if (report.bear.length === 0) {
    errors.push({ section: "bear", claim: null, reason: "empty-section" });
  }

  for (const section of ["bull", "bear"] as const) {
    report[section].forEach((claim, index) => {
      if (claim.sourceIds.length === 0) {
        errors.push({ section, claim: index + 1, reason: "no-sources" });
      }
      for (const id of claim.sourceIds) {
        if (!fetchedIds.has(id)) {
          errors.push({ section, claim: index + 1, reason: "unknown-source", sourceId: id });
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export type Claim = { text: string; sourceIds: string[] };
export type Report = { bull: Claim[]; bear: Claim[] };
export type FetchedSource = { id: string; url: string };
export type CitationError = { reason: "no-sources" | "unknown-source" };
export type ValidationResult = { valid: boolean; errors: CitationError[] };

export function validateReport(report: Report, fetchedSources: FetchedSource[]): ValidationResult {
  const fetchedIds = new Set(fetchedSources.map((source) => source.id));
  const errors: CitationError[] = [];

  for (const claim of [...report.bull, ...report.bear]) {
    if (claim.sourceIds.length === 0) {
      errors.push({ reason: "no-sources" });
    }
    for (const id of claim.sourceIds) {
      if (!fetchedIds.has(id)) {
        errors.push({ reason: "unknown-source" });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

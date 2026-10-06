/**
 * The report an approval is linked to.
 *
 * A headless App Master raises an approval for each report it posts and records
 * the pairing in the review's `context_data` JSON as `{ "reportId": "<id>" }`
 * (alongside whatever else the context carries - decisions, prose). Reviews
 * without that key, with no context, or with context that is not JSON are the
 * normal case and answer `null`: there is no link to show.
 */
export function parseLinkedReportId(contextData: string | null | undefined): string | null {
  if (!contextData) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contextData);
  } catch {
    // Free-text context is common; "not JSON" just means "no link".
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  // JSON.parse output: the typeof guard above is the invariant; the field is
  // type-checked before use.
  const reportId = (parsed as { reportId?: unknown }).reportId;
  return typeof reportId === 'string' && reportId.trim() !== '' ? reportId : null;
}

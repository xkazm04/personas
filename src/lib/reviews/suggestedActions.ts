/**
 * The single canonical parser for a review's `suggested_actions` field, shared
 * by every human-review surface (the Quick Answer stepper, the Overview triage
 * player + inbox detail). Phase 5 convergence — previously three near-duplicate
 * implementations drifted across those surfaces.
 *
 * Accepts every shape personas emit: a JSON array `["a","b"]`, a wrapped
 * `{"actions":[…]}`, or a plain string (split on `;` / newlines).
 */
export function parseSuggestedActions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
    }
    if (v && typeof v === 'object' && Array.isArray((v as { actions?: unknown }).actions)) {
      return (v as { actions: unknown[] }).actions
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((s) => s.trim());
    }
    return [];
  } catch {
    // Not JSON — a `;`/newline-delimited list, or a single action.
    return raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
  }
}

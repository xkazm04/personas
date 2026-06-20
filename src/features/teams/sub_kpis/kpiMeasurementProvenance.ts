/**
 * Turn a stored `DevKpiMeasurement.evidence` blob into a short, scannable
 * provenance line + the full text for a tooltip, so a measured KPI value can
 * be traced back to the command / basis / rows that produced it instead of
 * rendering as a bare number (UAT P7 — F-FINANCE-KPI-NO-RECIPE: provenance is
 * persisted but was never surfaced).
 *
 * Evidence is heterogeneous JSON written by the evaluator, e.g.
 *   {"cmd":"npx vitest run --coverage","output_tail":"…"}
 *   {"basis":"failed=8 total=38 window=7d","metric":"exec_failure_rate"}
 * …or occasionally free text. We surface the most meaningful key.
 */
export interface MeasurementProvenance {
  /** One-line, human-scannable summary of where the value came from. */
  summary: string | null;
  /** Full evidence (pretty-printed when JSON) for the hover/expand affordance. */
  full: string | null;
}

export function summarizeEvidence(evidence: string | null | undefined): MeasurementProvenance {
  if (!evidence) return { summary: null, full: null };
  const trimmed = evidence.trim();
  // Fallback for non-JSON / unrecognised evidence: show the raw text verbatim.
  const rawResult: MeasurementProvenance = {
    summary: trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
    full: evidence,
  };
  try {
    const parsed: unknown = JSON.parse(evidence);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      const full = JSON.stringify(o, null, 2);
      if (typeof o.cmd === 'string' && o.cmd) return { summary: o.cmd, full };
      if (typeof o.basis === 'string' && o.basis) return { summary: o.basis, full };
      if (typeof o.metric === 'string' && o.metric) return { summary: o.metric, full };
      const [firstKey] = Object.keys(o);
      if (firstKey !== undefined) {
        return { summary: `${firstKey}: ${String(o[firstKey]).slice(0, 60)}`, full };
      }
    }
  } catch {
    return rawResult; // not JSON
  }
  return rawResult;
}

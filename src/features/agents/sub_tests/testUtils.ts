// ── Composite score weights ──
// Keep in sync with WEIGHT_* constants in src-tauri/src/engine/test_runner.rs
export const WEIGHT_TOOL_ACCURACY = 0.4;
export const WEIGHT_OUTPUT_QUALITY = 0.4;
export const WEIGHT_PROTOCOL_COMPLIANCE = 0.2;

/** Compute the weighted composite score from individual metric scores. */
export function compositeScore(toolAccuracy: number, outputQuality: number, protocolCompliance: number): number {
  return Math.round(
    toolAccuracy * WEIGHT_TOOL_ACCURACY
    + outputQuality * WEIGHT_OUTPUT_QUALITY
    + protocolCompliance * WEIGHT_PROTOCOL_COMPLIANCE,
  );
}

/** Consolidated status → badge class map for test views. */
const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  // Test run statuses (PersonaTestsTab)
  generating: { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  running:    { bg: 'bg-primary/15', text: 'text-primary', border: 'border-primary/30' },
  completed:  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  // Test result statuses (TestComparisonTable)
  passed:     { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  // Shared
  failed:     { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/20' },
  cancelled:  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
  error:      { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' },
};

const FALLBACK = { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20' };

/** Return Tailwind class string for a status badge. */
export function statusBadge(status: string): string {
  const c = STATUS_STYLES[status] ?? FALLBACK;
  return `px-2 py-0.5 rounded-md text-sm font-medium border ${c.bg} ${c.text} ${c.border}`;
}

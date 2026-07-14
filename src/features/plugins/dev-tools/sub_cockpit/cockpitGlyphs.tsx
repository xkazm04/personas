// The cockpit's OWN glyph set (R2) — custom primitives shared by the new
// variants. Personas theming is the only frame: the neon accent discipline
// (teal / violet / amber + status hues), dark surface, typo-* scale. Nothing
// here is borrowed from existing feature modules; this file is the seed of the
// component set the winning variant will grow into.

export const NEON = {
  teal: '#2DD4BF',
  violet: '#8B5CF6',
  amber: '#F59E0B',
  red: '#F87171',
  emerald: '#34D399',
  sky: '#38BDF8',
} as const;

export const TONE_HEX: Record<string, string> = {
  success: NEON.emerald,
  warning: NEON.amber,
  error: NEON.red,
  neutral: '#64748B',
};

/** Verdict as a pulse glyph, not a chip:
 *  ◆ cleared · ▲ moved · ▬ unchanged · ▼ regressed (glowing — never quiet). */
export function VerdictPulse({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const map: Record<string, { d: string; c: string; label: string }> = {
    cleared: { d: 'M6 1 L11 6 L6 11 L1 6 Z', c: NEON.emerald, label: 'cleared — signal gone' },
    moved: { d: 'M1 11 L6 1 L11 11 Z', c: NEON.sky, label: 'moved — number improved' },
    unchanged: { d: 'M1 5 H11 V7 H1 Z', c: NEON.amber, label: 'unchanged — merged is not fixed' },
    regressed: { d: 'M1 1 L11 1 L6 11 Z', c: NEON.red, label: 'REGRESSED — number got worse' },
  };
  const g = map[verdict];
  if (!g) return null;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label={g.label} className="shrink-0">
      <title>{g.label}</title>
      <path d={g.d} fill={g.c} style={verdict === 'regressed' ? { filter: `drop-shadow(0 0 4px ${NEON.red})` } : undefined} />
    </svg>
  );
}

/** Finding lifecycle dot when there is no verdict yet: proposed (hollow teal) or
 *  in-flight (violet, breathing). */
export function StateDot({ state }: { state: 'proposed' | 'dispatched' }) {
  if (state === 'dispatched') {
    return (
      <span
        className="w-2 h-2 rounded-full shrink-0 animate-pulse"
        style={{ background: NEON.violet, boxShadow: `0 0 6px ${NEON.violet}` }}
        title="dispatched — in flight"
      />
    );
  }
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ border: `1px solid ${NEON.teal}`, background: 'transparent' }}
      title="proposed — awaiting triage/dispatch"
    />
  );
}

/** Deterministic pseudo-telemetry (no Math.random — renders must be stable). */
export function seededTrace(seed: string, trendPct: number | null, n = 24): number[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const jitter = ((h % 1000) / 1000 - 0.5) * 0.16;
    const drift = trendPct === null ? 0 : (trendPct / 100) * (i / n) * 0.5;
    pts.push(Math.min(0.92, Math.max(0.08, 0.55 + drift + jitter)));
  }
  return pts;
}

export function tracePath(pts: number[], w: number, hgt: number): string {
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * w).toFixed(1)},${((1 - p) * hgt).toFixed(1)}`)
    .join(' ');
}

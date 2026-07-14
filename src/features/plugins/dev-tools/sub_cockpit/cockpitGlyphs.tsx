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

// ============================================================================
// R3 additions — the health-grid cell vocabulary (50–100 contexts on screen).
// Colour + symbol carry ALL information at this density; names exist only in
// tooltips. One glyph max per cell; priority: regressed > inflight > moved >
// proposed (error/cost/kpi pressure is already the cell's colour).
// ============================================================================

import type { CellTone, LoopMark, MockContextGroup, MockProject } from './cockpitMock';
import { dominantTone, gridSummary } from './cockpitMock';

export const CELL_HEX: Record<CellTone, { fill: string; border: string }> = {
  crit: { fill: 'rgba(248,113,113,.28)', border: 'rgba(248,113,113,.75)' },
  warn: { fill: 'rgba(245,158,11,.22)', border: 'rgba(245,158,11,.55)' },
  ok: { fill: 'rgba(52,211,153,.13)', border: 'rgba(52,211,153,.35)' },
  unmeasured: { fill: 'rgba(148,163,184,.05)', border: 'rgba(148,163,184,.28)' },
};

export const MARK_LABEL: Record<Exclude<LoopMark, null>, string> = {
  regressed: 'verdict: REGRESSED — shipped and the number got worse',
  moved: 'verdict: moved — shipped and the number improved',
  inflight: 'dispatched — work in flight',
  proposed: 'finding proposed — awaiting triage',
};

/** The loop glyph inside a cell. Sized for ~20px cells. */
export function MarkGlyph({ mark }: { mark: LoopMark }) {
  if (!mark) return null;
  if (mark === 'regressed') {
    return <svg width="9" height="9" viewBox="0 0 10 10" className="shrink-0"><path d="M1 1 H9 L5 9 Z" fill={NEON.red} style={{ filter: `drop-shadow(0 0 3px ${NEON.red})` }} /></svg>;
  }
  if (mark === 'moved') {
    return <svg width="9" height="9" viewBox="0 0 10 10" className="shrink-0"><path d="M1 9 L5 1 L9 9 Z" fill={NEON.sky} /></svg>;
  }
  if (mark === 'inflight') {
    return <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: NEON.violet, boxShadow: `0 0 4px ${NEON.violet}` }} />;
  }
  return <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ border: `1px solid ${NEON.teal}` }} />;
}

/** Shared skinny masthead: identity + wiring lamps + the first-sight count line. */
export function GridMasthead({ project, groups }: { project: MockProject; groups: MockContextGroup[] }) {
  const s = gridSummary(groups);
  return (
    <div className="mx-5 mt-4 flex items-end justify-between gap-4 flex-wrap relative">
      <div className="min-w-0">
        <h2 className="typo-heading-lg text-foreground tracking-tight">{project.name}</h2>
        {s.total > 0 && (
          <div className="typo-caption tabular-nums mt-0.5 flex items-center gap-2.5">
            <span className="text-foreground/40">{s.total} contexts</span>
            {s.crit > 0 && <span style={{ color: NEON.red }}>● {s.crit} critical</span>}
            {s.warn > 0 && <span style={{ color: NEON.amber }}>● {s.warn} warning</span>}
            <span style={{ color: NEON.emerald }}>● {s.ok} healthy</span>
            {s.unmeasured > 0 && <span className="text-foreground/35">◌ {s.unmeasured} unmeasured</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {project.wiring.map((x) => (
          <span key={x.key} className="flex items-center gap-1.5" title={x.wired ? `${x.label} — wired` : `${x.label} — NOT wired: ${x.unlocks} stays dark`}>
            <span
              className="w-2 h-2 rounded-full"
              style={x.wired ? { background: NEON.teal, boxShadow: `0 0 5px ${NEON.teal}` } : { border: '1px dashed rgba(148,163,184,.45)' }}
            />
            <span className={`typo-label uppercase tracking-widest ${x.wired ? 'text-foreground/60' : 'text-foreground/30'}`}>{x.key}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Bare tier — a ghost grid: the map exists, nothing is measured yet. */
export function GhostGrid({ project }: { project: MockProject }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center relative" data-testid="cockpit-establish">
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(50% 50% at 50% 40%, ${NEON.violet}0d, transparent 70%)` }} />
      <div className="grid grid-cols-10 gap-1 mb-6 opacity-50">
        {Array.from({ length: 50 }).map((_, i) => (
          <span key={i} className="w-4 h-4 rounded-[3px]" style={{ border: '1px dashed rgba(148,163,184,.3)' }} />
        ))}
      </div>
      <p className="typo-section-title text-foreground relative">Nothing measured yet</p>
      <p className="typo-caption text-foreground/50 mt-1 max-w-md text-center relative">
        Fifty dark cells are waiting. Each connection below lights a dimension of
        every one of them.
      </p>
      <div className="mt-5 w-full max-w-md space-y-1 relative">
        {project.wiring.map((s2, i) => (
          <button key={s2.key} type="button" className="w-full flex items-center gap-3 rounded-card border border-foreground/[0.08] bg-black/20 px-3.5 py-2.5 hover:border-foreground/25 transition-colors text-left">
            <span className="typo-label tabular-nums text-foreground/30 w-4">{String(i + 1).padStart(2, '0')}</span>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ border: '1px dashed rgba(148,163,184,.5)' }} />
            <span className="min-w-0 flex-1">
              <span className="typo-caption font-medium text-foreground/85 uppercase tracking-wide block">{s2.label}</span>
              <span className="typo-label text-foreground/40 block truncate">lights {s2.unlocks}</span>
            </span>
            <span className="typo-label uppercase tracking-widest" style={{ color: `${NEON.teal}99` }}>wire ▸</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { dominantTone };

/** R6 — element-anchored tooltip placement. Anchoring to the CURSOR (R5) drifted
 *  away from the plate near window edges; anchoring to the hovered element's rect
 *  keeps the tooltip attached: below the plate, left-aligned, flipping above and
 *  clamping horizontally only when out of room. */
export function anchorTip(rect: DOMRect, w: number, h: number): { left: number; top: number } {
  let left = rect.left;
  let top = rect.bottom + 8;
  if (left + w > window.innerWidth - 12) left = Math.max(12, window.innerWidth - w - 12);
  if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 8);
  return { left, top };
}

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

// ============================================================================
// R7 additions — the PORTFOLIO vocabulary. The wall variants paint the passport
// row spec (passportRows CellValue) in Focus ink: thin progress lines, colour
// in text, greens recede, blue = setup. Plus the hierarchy breadcrumb.
// ============================================================================

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronsUpDown } from 'lucide-react';

import type { CellValue } from '@/features/teams/sub_factory/passport/passportRows';
import { AUTOMATION_LABEL, PROD_BAND_LABEL } from '@/features/teams/sub_factory/passport/passportModel';

/** The Focus SETUP hue (R6): unconfigured ≠ sick ≠ fine — it's an invitation. */
export const SETUP_BLUE = '#60A5FA';

/** Score → ink (0–100 readiness axes). */
export function scoreInk(score: number): string {
  if (score >= 70) return NEON.emerald;
  if (score >= 45) return NEON.amber;
  return NEON.red;
}

/** Ordinal position (0..1 in its scale) → ink. */
export function posInk(pos: number): string {
  if (pos >= 0.65) return NEON.emerald;
  if (pos >= 0.35) return NEON.amber;
  return NEON.red;
}

/** The wall's thin progress line — same grammar as Focus's KPI divider.
 *  pct null → dashed blue "nothing configured behind this line". */
export function ScoreLine({ pct, hue, faded }: { pct: number | null; hue?: string; faded?: boolean }) {
  if (pct === null) {
    return <span className="block border-t border-dashed" style={{ borderColor: `${SETUP_BLUE}66` }} />;
  }
  const ink = hue ?? scoreInk(pct);
  return (
    <span className="block h-[2px] rounded-full relative" style={{ background: 'rgba(148,163,184,.10)' }}>
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: ink, boxShadow: faded ? undefined : `0 0 4px ${ink}55` }}
      />
    </span>
  );
}

/** How a normalized passport cell reads in the Focus vocabulary — drives both
 *  ink and the recede rule (good/info fade so deficiencies stand alone). */
export type InkKind = 'good' | 'warn' | 'bad' | 'setup' | 'info';

export function inkKindOf(v: CellValue): InkKind {
  switch (v.kind) {
    case 'level':
    case 'band':
      return v.score >= 70 ? 'good' : v.score >= 45 ? 'warn' : 'bad';
    case 'ordinal':
      return v.pos >= 0.65 ? 'good' : v.pos >= 0.35 ? 'warn' : 'bad';
    case 'present':
      return v.label ? 'good' : 'setup';
    case 'chips':
      return v.items.length ? 'info' : 'setup';
    case 'pips': {
      const on = v.items.filter((i) => i.on).length;
      return on === v.items.length ? 'good' : on === 0 ? 'bad' : 'warn';
    }
    case 'bool':
      return v.on ? 'good' : 'warn';
  }
}

const INK_KIND_HEX: Record<InkKind, string> = {
  good: NEON.emerald, warn: NEON.amber, bad: NEON.red, setup: SETUP_BLUE, info: 'rgba(148,163,184,.85)',
};

/** Paints ONE normalized passport cell in Focus ink. Compact by design — the
 *  wall shows ~20 of these per project. */
export function InkCellValue({ value }: { value: CellValue }) {
  const kind = inkKindOf(value);
  const hue = INK_KIND_HEX[kind];
  switch (value.kind) {
    case 'level':
    case 'band': {
      const label = value.kind === 'level' ? `${value.level} · ${AUTOMATION_LABEL[value.level]}` : PROD_BAND_LABEL[value.band];
      return (
        <span className="block min-w-0">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium truncate" style={{ color: hue }}>{label}</span>
            <span className="text-[10px] tabular-nums text-foreground/40 shrink-0">{value.score}</span>
          </span>
          <span className="block mt-1"><ScoreLine pct={value.score} hue={hue} /></span>
        </span>
      );
    }
    case 'ordinal':
      return (
        <span className="block min-w-0">
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[10.5px] font-medium truncate" style={{ color: hue }}>{value.label}</span>
            {value.sub && <span className="text-[10px] text-foreground/40 truncate">{value.sub}</span>}
          </span>
          <span className="block mt-1"><ScoreLine pct={value.pos * 100} hue={hue} /></span>
        </span>
      );
    case 'present':
      return value.label ? (
        <span className="text-[10.5px] font-medium text-foreground/85 truncate block">{value.label}</span>
      ) : (
        <span className="text-[10.5px] font-medium" style={{ color: SETUP_BLUE }}>set up →</span>
      );
    case 'chips': {
      if (value.items.length === 0) return <span className="text-[10.5px] font-medium" style={{ color: SETUP_BLUE }}>add →</span>;
      const shown = value.items.slice(0, 2).join(' · ');
      const more = value.items.length - 2;
      return (
        <span className="text-[10.5px] text-foreground/70 truncate block">
          {shown}
          {more > 0 && <span className="text-foreground/40"> +{more}</span>}
        </span>
      );
    }
    case 'pips':
      return (
        <span className="inline-flex items-center gap-1">
          {value.items.map((p) => (
            <span
              key={p.label}
              title={`${p.label}: ${p.on ? 'yes' : 'no'}`}
              className="w-1.5 h-1.5 rounded-full"
              style={p.on ? { background: NEON.emerald } : { border: '1px solid rgba(148,163,184,.5)' }}
            />
          ))}
          <span className="text-[10px] tabular-nums ml-0.5" style={{ color: hue }}>
            {value.items.filter((p) => p.on).length}/{value.items.length}
          </span>
        </span>
      );
    case 'bool':
      return (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={value.on ? { background: NEON.emerald } : { border: `1px solid ${NEON.amber}88` }}
          />
          <span className="text-[10.5px]" style={{ color: value.on ? 'rgba(148,163,184,.85)' : NEON.amber }}>{value.on ? 'yes' : 'no'}</span>
        </span>
      );
  }
}

/** Editorial tab row — quiet uppercase labels, active = teal underline. The
 *  wall variants' sort control (no borrowed pill/segment chrome). */
export function InkTabs<T extends string>({ tabs, active, onChange, label }: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-3" role="tablist" aria-label={label}>
      <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/35">{label}</span>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`text-[10.5px] uppercase tracking-[0.1em] pb-0.5 border-b transition-colors focus-ring ${
              on ? 'text-foreground font-semibold' : 'text-foreground/45 hover:text-foreground/75 border-transparent'
            }`}
            style={on ? { borderColor: NEON.teal } : undefined}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// -- the hierarchy breadcrumb ----------------------------------------------------
// Portfolio ▸ Project [▾ sibling switcher]. Ancestors are quiet links; the leaf
// carries its worst-state dot and doubles as a jump menu between siblings — the
// breadcrumb IS the navigation manipulator, not just a location label.

export interface CrumbSibling {
  id: string;
  label: string;
  /** Short right-aligned note in the switcher (tier, counts…). */
  note?: string;
  hue: string;
}

export function CockpitBreadcrumb({ root, rootNote, onRoot, leaf }: {
  root: string;
  /** Shown after the root when it IS the current level ("3 projects"). */
  rootNote?: string;
  /** Present ⇒ root is an ancestor link back to the wall. */
  onRoot?: () => void;
  leaf?: {
    label: string;
    hue: string;
    siblings: CrumbSibling[];
    onSelect: (id: string) => void;
  };
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);

  return (
    <nav aria-label="Cockpit hierarchy" data-testid="cockpit-breadcrumb" className="flex items-center gap-1 min-w-0">
      {leaf && onRoot ? (
        <button
          type="button"
          onClick={onRoot}
          className="typo-caption text-foreground/50 hover:text-foreground transition-colors focus-ring rounded-interactive px-1 -mx-1"
        >
          {root}
        </button>
      ) : (
        <span className="typo-caption font-semibold text-foreground px-1 -mx-1">
          {root}
          {rootNote && <span className="typo-label text-foreground/40 font-normal ml-2">{rootNote}</span>}
        </span>
      )}

      {leaf && (
        <>
          <ChevronRight className="w-3 h-3 text-foreground/25 shrink-0" aria-hidden />
          <button
            type="button"
            data-testid="crumb-leaf"
            onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
            className="inline-flex items-center gap-1.5 min-w-0 px-1.5 py-0.5 rounded-md border border-transparent hover:border-foreground/15 hover:bg-foreground/[0.04] transition-colors focus-ring"
            title="Switch project"
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: leaf.hue, boxShadow: `0 0 5px ${leaf.hue}88` }} />
            <span className="typo-caption font-semibold text-foreground truncate">{leaf.label}</span>
            <ChevronsUpDown className="w-3 h-3 text-foreground/40 shrink-0" aria-hidden />
          </button>
          {menu && createPortal(
            <div
              data-testid="crumb-switcher"
              className="fixed z-50 w-[240px] rounded-xl overflow-hidden py-1"
              style={{
                ...anchorTip(menu, 240, 40 + leaf.siblings.length * 34),
                background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
                border: '1px solid rgba(148,163,184,.22)',
                boxShadow: '0 16px 40px rgba(0,0,0,.45)',
              }}
              onMouseLeave={() => setMenu(null)}
            >
              <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.14em] text-foreground/40">{root}</div>
              {leaf.siblings.map((s) => {
                const current = s.label === leaf.label;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setMenu(null); if (!current) leaf.onSelect(s.id); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.05] ${current ? 'bg-foreground/[0.03]' : ''}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.hue, boxShadow: `0 0 4px ${s.hue}77` }} />
                    <span className={`typo-caption truncate ${current ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>{s.label}</span>
                    {s.note && <span className="typo-label text-foreground/40 ml-auto shrink-0">{s.note}</span>}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
        </>
      )}
    </nav>
  );
}

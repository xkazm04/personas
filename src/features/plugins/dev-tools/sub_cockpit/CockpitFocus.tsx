// VARIANT K — "Focus" (R6 — the fusion: Console's group boxes in Cards' skin,
// with a content strategy built for ASSESSING WHAT TO FOCUS ON).
//
// Three moves beyond the Cards baseline:
//   1. The plate's divider IS a KPI progress line — a 2px track whose fill is
//      the KPI's % of target in its tone. The divider stops being decoration
//      and becomes the most important number, pre-attentive.
//   2. All-green contexts RECEDE: title stays fully readable, everything else
//      drops to low opacity on a faint green wash. Health isn't hidden — it
//      just stops competing for attention. What's left standing is the work.
//   3. A new SETUP state (blue): a context whose KPI isn't defined or whose
//      sensors aren't wired isn't "sick" and isn't "fine" — it's UNCONFIGURED,
//      an invitation. Blue dashed plates with an explicit "define KPI →" /
//      "wire sensors →" line.
//
// Group boxes come from Console (framed blocks, worst-state lamp + counts) but
// wear Cards' editorial ink: soft rounding, hairline borders, colour in text.
// Tooltip: Cards' elevated card, ELEMENT-ANCHORED (R6 positioning fix), with a
// focus sentence tailored per state.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CircleDollarSign, Wrench } from 'lucide-react';
import { GhostGrid, GridMasthead, NEON, SETUP_BLUE, anchorTip, dominantTone } from './cockpitGlyphs';
import {
  cellStats, gridFor,
  type CellTone, type MockContextCell, type MockContextGroup, type MockProject,
} from './cockpitMock';

const BLUE = SETUP_BLUE;
type InkKey = CellTone | 'setup';
const INK: Record<InkKey, string> = {
  crit: NEON.red, warn: NEON.amber, ok: NEON.emerald, setup: BLUE, unmeasured: 'rgba(148,163,184,.45)',
};

/** The plate's presentation state. Setup wins over "ok" when the KPI is not
 *  defined (nothing honest to be green ABOUT) or nothing is measured at all. */
type FocusKind = 'crit' | 'warn' | 'setup' | 'ok';
function focusKind(cell: MockContextCell): FocusKind {
  const t = dominantTone(cell);
  if (t === 'crit') return 'crit';
  if (t === 'warn') return 'warn';
  if (cell.dims.kpi === 'unmeasured' || t === 'unmeasured') return 'setup';
  return 'ok';
}

/** What a setup plate asks for. */
function setupAsk(cell: MockContextCell): string {
  if (cell.dims.kpi === 'unmeasured' && (cell.dims.errors === 'unmeasured' || cell.dims.cost === 'unmeasured')) return 'define KPI · wire sensors →';
  if (cell.dims.kpi === 'unmeasured') return 'define KPI →';
  return 'wire sensors →';
}

// -- KPI progress divider ---------------------------------------------------------

function KpiLine({ cell, faded }: { cell: MockContextCell; faded?: boolean }) {
  const s = cellStats(cell);
  if (s.kpiPct === null) {
    return <span className="block my-1.5 border-t border-dashed" style={{ borderColor: `${BLUE}66` }} title="No KPI defined for this context" />;
  }
  const pct = Math.min(100, s.kpiPct);
  const hue = INK[cell.dims.kpi];
  return (
    <span className={`block my-1.5 h-[2px] rounded-full relative ${faded ? '' : ''}`} style={{ background: 'rgba(148,163,184,.10)' }} title={`KPI at ${s.kpiPct}% of target`}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: hue, boxShadow: faded ? undefined : `0 0 4px ${hue}66` }} />
    </span>
  );
}

// -- the custom tooltip (element-anchored) ------------------------------------------

interface TipState { cell: MockContextCell; group: string; rect: DOMRect }

const FOCUS_SENTENCE: Record<FocusKind, (c: MockContextCell) => string> = {
  crit: () => 'Needs attention now — a dimension is critical.',
  warn: () => 'Drifting — worth a look this week.',
  setup: (c) => `Unconfigured — ${setupAsk(c).replace(' →', '')}.`,
  ok: () => 'All clear. Nothing here needs you.',
};

function FocusTooltip({ tip }: { tip: TipState }) {
  const { cell, group } = tip;
  const kind = focusKind(cell);
  const s = cellStats(cell);
  const { left, top } = anchorTip(tip.rect, 280, 200);
  const dim = (label: string, value: string | null, hue: string) => (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/40">{label}</span>
      <span className="block typo-caption font-medium tabular-nums" style={{ color: value === null ? BLUE : hue }}>
        {value ?? 'set up →'}
      </span>
    </div>
  );
  // PORTAL: `position:fixed` resolves against a transformed ancestor (the page
  // wrapper animates with a transform), which displaced the tooltip — the R5
  // "far from the element" bug. Rendering into document.body restores viewport
  // coordinates.
  return createPortal(
    <div
      data-testid="cockpit-tooltip"
      className="fixed z-50 w-[280px] pointer-events-none rounded-xl overflow-hidden"
      style={{
        left, top,
        background: 'color-mix(in srgb, var(--background) 88%, #1e293b)',
        border: `1px solid ${INK[kind]}44`,
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
    >
      <div className="px-4 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{group}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="typo-body font-semibold text-foreground truncate">{cell.short}</span>
          <span className="ml-auto shrink-0 rounded-full px-2 py-[2px] text-[10px] font-medium tracking-wide" style={{ color: INK[kind], border: `1px solid ${INK[kind]}55`, background: `${INK[kind]}14` }}>
            {kind === 'setup' ? 'Setup needed' : kind === 'ok' ? 'Healthy' : kind === 'crit' ? 'Critical' : 'Warning'}
          </span>
        </div>
      </div>
      <div className="mx-4"><KpiLine cell={cell} /></div>
      <div className="px-4 pb-2.5 pt-1 grid grid-cols-3 gap-x-3">
        {dim('Errors', s.errs === null ? null : `${s.errs} /14d`, INK[cell.dims.errors])}
        {dim('LLM cost', s.costUsd === null ? null : `$${s.costUsd} /30d`, INK[cell.dims.cost])}
        {dim('KPI', s.kpiPct === null ? null : `${s.kpiPct}%`, INK[cell.dims.kpi])}
      </div>
      <div className="px-4 pb-3 typo-caption" style={{ color: INK[kind] }}>
        {FOCUS_SENTENCE[kind](cell)}
      </div>
    </div>,
    document.body,
  );
}

// -- the plate -----------------------------------------------------------------------

function Plate({ cell, group, onHover, onLeave }: {
  cell: MockContextCell; group: string;
  onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const kind = focusKind(cell);
  const s = cellStats(cell);
  const enter = (e: React.MouseEvent<HTMLButtonElement>) =>
    onHover({ cell, group, rect: e.currentTarget.getBoundingClientRect() });

  const pair = (Icon: typeof AlertTriangle, v: string | null, hue: string) => (
    <span className="flex items-center gap-1 min-w-0" style={{ color: v === null ? BLUE : hue }}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="text-[10.5px] font-medium tabular-nums truncate">{v ?? '·'}</span>
    </span>
  );

  if (kind === 'ok') {
    // Recede: title fully readable; everything else fades on a green wash.
    return (
      <button
        type="button"
        className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg relative focus-ring transition-all hover:-translate-y-[1px]"
        style={{ background: 'rgba(52,211,153,.05)', border: '1px solid rgba(52,211,153,.10)' }}
        onMouseEnter={enter} onMouseLeave={onLeave}
      >
        <span className="typo-caption font-medium text-foreground/85 truncate block">{cell.short}</span>
        <span className="block opacity-30">
          <KpiLine cell={cell} faded />
          <span className="flex items-center gap-2.5 min-w-0">
            {pair(AlertTriangle, s.errs === null ? null : String(s.errs), INK.ok)}
            {pair(CircleDollarSign, s.costUsd === null ? null : `$${s.costUsd}`, INK.ok)}
          </span>
        </span>
      </button>
    );
  }

  if (kind === 'setup') {
    return (
      <button
        type="button"
        className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg relative focus-ring transition-all hover:-translate-y-[1px]"
        style={{ background: `${BLUE}0a`, border: `1px dashed ${BLUE}55` }}
        onMouseEnter={enter} onMouseLeave={onLeave}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Wrench className="w-3 h-3 shrink-0" style={{ color: BLUE }} aria-hidden />
          <span className="typo-caption font-medium text-foreground/90 truncate">{cell.short}</span>
        </span>
        <KpiLine cell={cell} />
        <span className="text-[10.5px] font-medium" style={{ color: BLUE }}>{setupAsk(cell)}</span>
      </button>
    );
  }

  const hue = INK[kind];
  return (
    <button
      type="button"
      className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg relative focus-ring transition-all hover:-translate-y-[1px]"
      style={{
        background: 'rgba(148,163,184,.045)',
        border: `1px solid ${hue}${kind === 'crit' ? '66' : '3d'}`,
        boxShadow: cell.mark === 'regressed' ? `0 0 12px ${NEON.red}55` : kind === 'crit' ? `0 0 8px ${NEON.red}22` : undefined,
      }}
      onMouseEnter={enter} onMouseLeave={onLeave}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: hue, boxShadow: `0 0 5px ${hue}88` }} />
        <span className="typo-caption font-medium text-foreground/90 truncate">{cell.short}</span>
        {cell.mark === 'regressed' && <span className="ml-auto text-[9px] font-semibold tracking-wide shrink-0" style={{ color: NEON.red }}>▼ REG</span>}
        {cell.mark === 'inflight' && <span className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: NEON.violet }} />}
      </span>
      <KpiLine cell={cell} />
      <span className="flex items-center gap-2.5 min-w-0">
        {pair(AlertTriangle, s.errs === null ? null : String(s.errs), INK[cell.dims.errors])}
        {pair(CircleDollarSign, s.costUsd === null ? null : `$${s.costUsd}`, INK[cell.dims.cost])}
      </span>
    </button>
  );
}

// -- group boxes (Console's frames, Cards' ink) ----------------------------------------

function GroupBox({ group, onHover, onLeave }: {
  group: MockContextGroup; onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const kinds = group.cells.map(focusKind);
  const crit = kinds.filter((k) => k === 'crit').length;
  const warn = kinds.filter((k) => k === 'warn').length;
  const setup = kinds.filter((k) => k === 'setup').length;
  const worst: FocusKind = crit > 0 ? 'crit' : warn > 0 ? 'warn' : setup === group.cells.length ? 'setup' : 'ok';
  return (
    <div className="rounded-xl p-3" style={{ border: `1px solid ${INK[worst]}2e`, background: 'rgba(148,163,184,.025)' }}>
      <div className="flex items-baseline gap-2 mb-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 self-center" style={{ background: INK[worst], boxShadow: `0 0 5px ${INK[worst]}88` }} />
        <h3 className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{group.name}</h3>
        <span className="ml-auto text-[10px] tabular-nums shrink-0 flex items-center gap-2">
          {crit > 0 && <span style={{ color: NEON.red }}>{crit} critical</span>}
          {warn > 0 && <span style={{ color: NEON.amber }}>{warn} warning</span>}
          {setup > 0 && <span style={{ color: BLUE }}>{setup} setup</span>}
          <span className="text-foreground/30">{group.cells.length}</span>
        </span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
        {group.cells.map((c) => <Plate key={c.id} cell={c} group={group.name} onHover={onHover} onLeave={onLeave} />)}
      </div>
    </div>
  );
}

export default function CockpitFocus({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  const [tip, setTip] = useState<TipState | null>(null);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-focus">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-focus" onMouseLeave={() => setTip(null)}>
      <GridMasthead project={project} groups={groups} />
      <div className="mx-5 mt-4 grid gap-2.5 relative" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {groups.map((g) => <GroupBox key={g.id} group={g} onHover={setTip} onLeave={() => setTip(null)} />)}
      </div>
      {tip && <FocusTooltip tip={tip} />}
    </div>
  );
}

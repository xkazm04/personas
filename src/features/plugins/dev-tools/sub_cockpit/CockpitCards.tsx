// VARIANT J — "Cards" (R5 — two-row plates + custom tooltip, editorial identity).
//
// Design identity: SOFT EDITORIAL. Where Console is a terminal, Cards is a
// well-set index: humanist contrast (weight + tracking instead of mono),
// generous rounding, near-invisible fills — COLOUR LIVES IN THE TEXT AND ICONS,
// not in backgrounds. Calm surfaces, precise ink. State is typography.
//
// Plate anatomy: row 1 = name (medium weight) + state dot · hairline divider ·
// row 2 = icon+number pairs (errors · cost · kpi) tinted per dimension.
// Custom tooltip: an elevated card — rounded, soft shadow, header with a state
// pill, a two-column dimension grid, a sentence for the loop mark. Built to
// host larger formatted content later (R6+).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CircleDollarSign, Gauge, Radio, Send, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { GhostGrid, GridMasthead, NEON, anchorTip, dominantTone } from './cockpitGlyphs';
import {
  cellStats, gridFor,
  type CellTone, type MockContextCell, type MockContextGroup, type MockProject,
} from './cockpitMock';

const INK: Record<CellTone, string> = {
  crit: NEON.red, warn: NEON.amber, ok: NEON.emerald, unmeasured: 'rgba(148,163,184,.45)',
};
const TONE_WORD: Record<CellTone, string> = { crit: 'Critical', warn: 'Warning', ok: 'Healthy', unmeasured: 'Unmeasured' };

const MARK_META: Record<string, { Icon: typeof Send; c: string; sentence: string }> = {
  regressed: { Icon: TrendingDown, c: NEON.red, sentence: 'Shipped — and the number got worse.' },
  moved: { Icon: TrendingUp, c: NEON.sky, sentence: 'Shipped — the number improved.' },
  inflight: { Icon: Send, c: NEON.violet, sentence: 'Dispatched — work is in flight.' },
  proposed: { Icon: Sparkles, c: NEON.teal, sentence: 'A finding is proposed, awaiting triage.' },
};

// -- the custom tooltip -------------------------------------------------------------

interface TipState { cell: MockContextCell; group: string; rect: DOMRect }

function CardTooltip({ tip }: { tip: TipState }) {
  const { cell, group } = tip;
  const tone = dominantTone(cell);
  const s = cellStats(cell);
  const mark = cell.mark ? MARK_META[cell.mark] : null;
  // R6 positioning fix: anchored to the hovered plate, not the cursor.
  const { left, top } = anchorTip(tip.rect, 280, 210);
  const dim = (Icon: typeof Gauge, label: string, value: string | null, hue: string) => (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: value === null ? 'rgba(148,163,184,.35)' : hue }} aria-hidden />
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/40">{label}</span>
        <span className="block typo-caption font-medium tabular-nums" style={{ color: value === null ? 'rgba(148,163,184,.45)' : 'var(--foreground)' }}>
          {value ?? 'not wired'}
        </span>
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
        border: '1px solid rgba(148,163,184,.16)',
        boxShadow: '0 16px 40px rgba(0,0,0,.45)',
      }}
    >
      <div className="px-4 pt-3 pb-2.5">
        <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">{group}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="typo-body font-semibold text-foreground truncate">{cell.short}</span>
          <span
            className="ml-auto shrink-0 rounded-full px-2 py-[2px] text-[10px] font-medium tracking-wide"
            style={{ color: INK[tone], border: `1px solid ${INK[tone]}55`, background: `${INK[tone]}14` }}
          >
            {TONE_WORD[tone]}
          </span>
        </div>
      </div>
      <div className="mx-4 border-t border-foreground/[0.08]" />
      <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {dim(AlertTriangle, 'Errors / 14d', s.errs === null ? null : `${s.errs} events`, INK[cell.dims.errors])}
        {dim(CircleDollarSign, 'LLM cost / 30d', s.costUsd === null ? null : `$${s.costUsd}`, INK[cell.dims.cost])}
        {dim(Gauge, 'KPI attainment', s.kpiPct === null ? null : `${s.kpiPct}% of target`, INK[cell.dims.kpi])}
        {dim(Radio, 'Loop', cell.mark ? cell.mark : 'quiet', cell.mark ? MARK_META[cell.mark]!.c : 'rgba(148,163,184,.5)')}
      </div>
      {mark && (
        <div className="px-4 pb-3 -mt-0.5 flex items-center gap-1.5" style={{ color: mark.c }}>
          <mark.Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="typo-caption">{mark.sentence}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}

// -- the plate -----------------------------------------------------------------------

function Plate({ cell, group, onHover, onLeave }: {
  cell: MockContextCell; group: string;
  onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const tone = dominantTone(cell);
  const s = cellStats(cell);
  const mark = cell.mark ? MARK_META[cell.mark] : null;
  const pair = (Icon: typeof Gauge, v: string | null, hue: string) => (
    <span className="flex items-center gap-1 min-w-0" style={{ color: v === null ? 'rgba(148,163,184,.28)' : hue }}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      <span className="text-[10.5px] font-medium tabular-nums truncate">{v ?? '—'}</span>
    </span>
  );
  return (
    <button
      type="button"
      className="text-left min-w-0 px-2.5 pt-1.5 pb-2 rounded-lg transition-all hover:-translate-y-[1px] hover:z-10 relative focus-ring"
      style={{
        background: tone === 'unmeasured' ? 'transparent' : 'rgba(148,163,184,.045)',
        border: `1px ${tone === 'unmeasured' ? 'dashed' : 'solid'} rgba(148,163,184,${tone === 'crit' ? '.0' : '.13'})`,
        ...(tone === 'crit' ? { border: `1px solid ${NEON.red}66`, boxShadow: `0 0 10px ${NEON.red}22` } : {}),
        ...(cell.mark === 'regressed' ? { boxShadow: `0 0 12px ${NEON.red}55` } : {}),
      }}
      onMouseEnter={(e) => onHover({ cell, group, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={onLeave}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={tone === 'unmeasured' ? { border: `1px dashed ${INK.unmeasured}` } : { background: INK[tone], boxShadow: `0 0 5px ${INK[tone]}88` }} />
        <span className={`typo-caption font-medium truncate ${tone === 'unmeasured' ? 'text-foreground/35' : 'text-foreground/90'}`}>{cell.short}</span>
        {mark && <mark.Icon className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: mark.c }} aria-hidden />}
      </span>
      <span className="block border-t border-foreground/[0.07] my-1.5" />
      <span className="flex items-center gap-2.5 min-w-0">
        {pair(AlertTriangle, s.errs === null ? null : String(s.errs), INK[cell.dims.errors])}
        {pair(CircleDollarSign, s.costUsd === null ? null : `$${s.costUsd}`, INK[cell.dims.cost])}
        {pair(Gauge, s.kpiPct === null ? null : `${s.kpiPct}%`, INK[cell.dims.kpi])}
      </span>
    </button>
  );
}

function GroupSection({ group, onHover, onLeave }: {
  group: MockContextGroup; onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const tones = group.cells.map(dominantTone);
  const crit = tones.filter((t) => t === 'crit').length;
  const warn = tones.filter((t) => t === 'warn').length;
  const worst: CellTone = crit > 0 ? 'crit' : warn > 0 ? 'warn' : tones.every((t) => t === 'unmeasured') ? 'unmeasured' : 'ok';
  return (
    <section className="mb-4">
      <div className="flex items-baseline gap-2 mb-1.5 min-w-0">
        <h3 className="typo-caption font-semibold tracking-tight text-foreground/85 truncate">{group.name}</h3>
        <span className="text-[10px] tabular-nums" style={{ color: INK[worst] }}>
          {crit > 0 ? `${crit} critical` : warn > 0 ? `${warn} warning` : worst === 'ok' ? 'healthy' : 'unmeasured'}
        </span>
        <span className="flex-1 border-t border-foreground/[0.06] translate-y-[-3px]" />
        <span className="text-[10px] text-foreground/30 tabular-nums shrink-0">{group.cells.length}</span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
        {group.cells.map((c) => <Plate key={c.id} cell={c} group={group.name} onHover={onHover} onLeave={onLeave} />)}
      </div>
    </section>
  );
}

export default function CockpitCards({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  const [tip, setTip] = useState<TipState | null>(null);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-cards">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-cards" onMouseLeave={() => setTip(null)}>
      <GridMasthead project={project} groups={groups} />
      <div className="mx-5 mt-4 relative">
        {groups.map((g) => <GroupSection key={g.id} group={g} onHover={setTip} onLeave={() => setTip(null)} />)}
      </div>
      {tip && <CardTooltip tip={tip} />}
    </div>
  );
}

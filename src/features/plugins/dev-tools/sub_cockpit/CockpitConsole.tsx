// VARIANT I — "Console" (R5 — two-row plates + custom tooltip, ops identity).
//
// Design identity: an OPERATIONS CONSOLE. Monospace numerals, lowercase mono
// labels, sharp 3px corners, near-black slabs, hairline dashed dividers. Colour
// is rationed: the base is grey-on-dark; only STATE gets hue. Reads like a
// well-kept terminal dashboard — dense, exact, calm.
//
// Plate anatomy: row 1 = name + loop token · dashed divider · row 2 = the three
// numbers that matter (▲errors · $cost · kpi%), each in its dimension's tone.
// Custom tooltip: a console panel — tone-edged slab, mono label/value rows,
// designed to grow richer formatted content later (R6+).
import { useState } from 'react';
import { CELL_HEX, GhostGrid, GridMasthead, NEON, dominantTone } from './cockpitGlyphs';
import {
  cellStats, gridFor,
  type CellTone, type MockContextCell, type MockContextGroup, type MockProject,
} from './cockpitMock';

const TONE_TXT: Record<CellTone, string> = {
  crit: NEON.red, warn: NEON.amber, ok: NEON.emerald, unmeasured: 'rgba(148,163,184,.4)',
};

/** Loop state as a mono token — this identity speaks in characters, not icons. */
const MARK_TOKEN: Record<string, { t: string; c: string; label: string }> = {
  regressed: { t: '▼reg', c: NEON.red, label: 'REGRESSED — shipped, number got worse' },
  moved: { t: '▲mov', c: NEON.sky, label: 'moved — shipped, number improved' },
  inflight: { t: '●run', c: NEON.violet, label: 'dispatched — in flight' },
  proposed: { t: '○new', c: NEON.teal, label: 'finding proposed' },
};

// -- the custom tooltip -------------------------------------------------------------

interface TipState { cell: MockContextCell; group: string; x: number; y: number }

function ConsoleTooltip({ tip }: { tip: TipState }) {
  const { cell, group } = tip;
  const tone = dominantTone(cell);
  const s = cellStats(cell);
  const mark = cell.mark ? MARK_TOKEN[cell.mark] : null;
  const row = (label: string, value: string | null, hue: string) => (
    <div className="flex items-baseline gap-2">
      <span className="text-foreground/40 w-14 shrink-0">{label}</span>
      <span className="flex-1 border-b border-dashed border-foreground/10 translate-y-[-3px]" />
      <span style={{ color: value === null ? 'rgba(148,163,184,.4)' : hue }}>{value ?? 'unwired'}</span>
    </div>
  );
  const left = Math.min(tip.x + 14, window.innerWidth - 280);
  const top = Math.min(tip.y + 14, window.innerHeight - 190);
  return (
    <div
      data-testid="cockpit-tooltip"
      className="fixed z-50 w-[260px] font-mono text-[11px] leading-relaxed pointer-events-none"
      style={{
        left, top,
        background: 'rgba(3,6,12,.96)',
        border: '1px solid rgba(148,163,184,.18)',
        borderLeft: `3px solid ${TONE_TXT[tone]}`,
        borderRadius: 3,
        boxShadow: `0 8px 28px rgba(0,0,0,.5), 0 0 12px ${TONE_TXT[tone]}22`,
      }}
    >
      {/* header bar */}
      <div className="px-3 pt-2 pb-1.5 border-b border-foreground/10">
        <div className="text-foreground/40">{group.toLowerCase()}/</div>
        <div className="text-foreground font-semibold tracking-tight">{cell.short}</div>
      </div>
      {/* the numbers */}
      <div className="px-3 py-2 space-y-1">
        {row('errors', s.errs === null ? null : `${s.errs} ev/14d`, TONE_TXT[cell.dims.errors])}
        {row('cost', s.costUsd === null ? null : `$${s.costUsd}/30d`, TONE_TXT[cell.dims.cost])}
        {row('kpi', s.kpiPct === null ? null : `${s.kpiPct}% of target`, TONE_TXT[cell.dims.kpi])}
        {mark && (
          <div className="pt-1 mt-1 border-t border-dashed border-foreground/10" style={{ color: mark.c }}>
            {mark.t} — <span className="text-foreground/60">{mark.label}</span>
          </div>
        )}
      </div>
      {/* footer hint — the future click-through's home */}
      <div className="px-3 py-1 border-t border-foreground/10 text-foreground/30">click → kpi detail (next round)</div>
    </div>
  );
}

// -- the plate -----------------------------------------------------------------------

function Plate({ cell, group, onHover, onLeave }: {
  cell: MockContextCell; group: string;
  onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const tone = dominantTone(cell);
  const s = cellStats(cell);
  const mark = cell.mark ? MARK_TOKEN[cell.mark] : null;
  const num = (v: string | null, hue: string) => (
    <span style={{ color: v === null ? 'rgba(148,163,184,.25)' : hue }}>{v ?? '–'}</span>
  );
  return (
    <button
      type="button"
      className="text-left min-w-0 px-2 pt-1 pb-1.5 transition-transform hover:scale-[1.03] hover:z-10 relative focus-ring font-mono"
      style={{
        borderRadius: 3,
        background: tone === 'unmeasured' ? 'rgba(148,163,184,.04)' : 'rgba(3,6,12,.5)',
        border: `1px ${tone === 'unmeasured' ? 'dashed' : 'solid'} ${CELL_HEX[tone].border}`,
        boxShadow: cell.mark === 'regressed' ? `0 0 9px ${NEON.red}77` : undefined,
      }}
      onMouseEnter={(e) => onHover({ cell, group, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onHover({ cell, group, x: e.clientX, y: e.clientY })}
      onMouseLeave={onLeave}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={`text-[11px] tracking-tight truncate ${tone === 'unmeasured' ? 'text-foreground/35' : 'text-foreground/85'}`}>
          {cell.short}
        </span>
        {mark && <span className="ml-auto shrink-0 text-[10px]" style={{ color: mark.c }}>{mark.t}</span>}
      </span>
      <span className="block border-t border-dashed border-foreground/10 my-1" />
      <span className="flex items-center gap-2 text-[10px] tabular-nums min-w-0">
        {num(s.errs === null ? null : `▲${s.errs}`, TONE_TXT[cell.dims.errors])}
        {num(s.costUsd === null ? null : `$${s.costUsd}`, TONE_TXT[cell.dims.cost])}
        {num(s.kpiPct === null ? null : `${s.kpiPct}%`, TONE_TXT[cell.dims.kpi])}
      </span>
    </button>
  );
}

function GroupBlock({ group, onHover, onLeave }: {
  group: MockContextGroup; onHover: (t: TipState) => void; onLeave: () => void;
}) {
  const tones = group.cells.map(dominantTone);
  const crit = tones.filter((t) => t === 'crit').length;
  const worst: CellTone = crit > 0 ? 'crit' : tones.includes('warn') ? 'warn' : tones.every((t) => t === 'unmeasured') ? 'unmeasured' : 'ok';
  return (
    <div className="p-2.5" style={{ borderRadius: 3, background: 'rgba(0,0,0,.22)', border: `1px solid ${CELL_HEX[worst].border}` }}>
      <div className="flex items-center gap-1.5 mb-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span style={{ color: TONE_TXT[worst] }}>▪</span>
        <span className="text-foreground/50 truncate">{group.name}</span>
        <span className="ml-auto text-foreground/30 tabular-nums shrink-0">
          {crit > 0 && <span style={{ color: NEON.red }}>{crit}! </span>}{group.cells.length}
        </span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
        {group.cells.map((c) => <Plate key={c.id} cell={c} group={group.name} onHover={onHover} onLeave={onLeave} />)}
      </div>
    </div>
  );
}

export default function CockpitConsole({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  const [tip, setTip] = useState<TipState | null>(null);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-console">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-console" onMouseLeave={() => setTip(null)}>
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: 'radial-gradient(70% 100% at 20% 0%, rgba(148,163,184,.05), transparent 60%)' }} />
      <GridMasthead project={project} groups={groups} />
      <div className="mx-5 mt-3 grid gap-2.5 relative" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        {groups.map((g) => <GroupBlock key={g.id} group={g} onHover={setTip} onLeave={() => setTip(null)} />)}
      </div>
      {tip && <ConsoleTooltip tip={tip} />}
    </div>
  );
}

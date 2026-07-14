// VARIANT F — "Spectrum" (R3 — the first-layer health grid).
//
// Metaphor: a SPECTROGRAM of the codebase. The grid is composed BY DIMENSION
// *inside each cell*: every context is a 2×2 quadrant —
//        errors | cost
//        kpi    | loop
// — so a cell doesn't just say "unhealthy", it says WHICH KIND. Rows are
// context groups sorted worst-first; within a row, cells sort worst-first too
// (triage order, not architectural order). Group-level status = the left rail's
// four DIMENSION LAMPS (the group's worst state per dimension) + a hot count.
//
// The composition's superpower: an unwired sensor is a dark quadrant in EVERY
// cell of the map — the argument for wiring, made visible at one glance.
// A regressed loop verdict rings the whole cell red.
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { CELL_HEX, GhostGrid, GridMasthead, MARK_LABEL, NEON } from './cockpitGlyphs';
import {
  dominantTone, gridFor,
  type CellTone, type MockContextCell, type MockContextGroup, type MockProject,
} from './cockpitMock';

const DIMS = ['errors', 'cost', 'kpi', 'loop'] as const;
const DIM_LABEL: Record<(typeof DIMS)[number], string> = { errors: 'ERR', cost: 'CST', kpi: 'KPI', loop: 'LOOP' };

const RANK: Record<CellTone, number> = { crit: 0, warn: 1, ok: 2, unmeasured: 3 };
const worstOf = (ts: CellTone[]): CellTone => ts.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'unmeasured' as CellTone);

function Quad({ tone }: { tone: CellTone }) {
  const hex = CELL_HEX[tone];
  return (
    <span
      className="w-full h-full rounded-[2px]"
      style={{ background: hex.fill, border: `1px ${tone === 'unmeasured' ? 'dashed' : 'solid'} ${hex.border}` }}
    />
  );
}

function SpectrumCell({ cell }: { cell: MockContextCell }) {
  const regressed = cell.mark === 'regressed';
  return (
    <button
      type="button"
      className="w-[26px] h-[26px] rounded-[5px] p-[2px] grid grid-cols-2 grid-rows-2 gap-[1px] transition-transform hover:scale-125 hover:z-10 relative focus-ring"
      style={{
        background: 'rgba(0,0,0,.25)',
        border: regressed ? `1.5px solid ${NEON.red}` : '1px solid rgba(148,163,184,.12)',
        boxShadow: regressed ? `0 0 9px ${NEON.red}99` : undefined,
      }}
      title={`${cell.name} — errors:${cell.dims.errors} · cost:${cell.dims.cost} · kpi:${cell.dims.kpi} · loop:${cell.dims.loop}${cell.mark ? ` · ${MARK_LABEL[cell.mark]}` : ''}`}
    >
      <Quad tone={cell.dims.errors} />
      <Quad tone={cell.dims.cost} />
      <Quad tone={cell.dims.kpi} />
      <Quad tone={cell.dims.loop} />
    </button>
  );
}

function DimLamp({ dim, tone }: { dim: (typeof DIMS)[number]; tone: CellTone }) {
  const c = tone === 'crit' ? NEON.red : tone === 'warn' ? NEON.amber : tone === 'ok' ? NEON.emerald : 'rgba(148,163,184,.35)';
  return (
    <span className="flex items-center gap-1" title={`${dim}: ${tone === 'unmeasured' ? 'not measured (wire the sensor)' : tone}`}>
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={tone === 'unmeasured' ? { border: `1px dashed ${c}` } : { background: c, boxShadow: `0 0 4px ${c}` }}
      />
      <span className="typo-label tracking-widest text-foreground/35">{DIM_LABEL[dim]}</span>
    </span>
  );
}

function GroupRow({ group, index }: { group: MockContextGroup; index: number }) {
  const { shouldAnimate } = useMotion();
  const crit = group.cells.filter((c) => dominantTone(c) === 'crit').length;
  // Triage order inside the row: worst first.
  const sorted = [...group.cells].sort((a, b) => RANK[dominantTone(a)] - RANK[dominantTone(b)]);
  const dimWorst = (d: (typeof DIMS)[number]) => worstOf(group.cells.map((c) => c.dims[d]));

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, x: -10 } : { opacity: 0 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
      className="flex items-start gap-3 py-2 border-b border-foreground/[0.05] last:border-b-0"
    >
      {/* group rail — name + per-dimension lamps (the group-level status) */}
      <div className="w-44 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="typo-caption font-medium text-foreground/80 truncate">{group.name}</span>
          {crit > 0 && <span className="typo-label tabular-nums shrink-0" style={{ color: NEON.red }}>{crit}▲</span>}
        </div>
        <div className="flex items-center gap-2.5 mt-1">
          {DIMS.map((d) => <DimLamp key={d} dim={d} tone={dimWorst(d)} />)}
        </div>
      </div>
      {/* the spectrum */}
      <div className="flex flex-wrap gap-[3px] min-w-0">
        {sorted.map((c) => <SpectrumCell key={c.id} cell={c} />)}
      </div>
    </motion.div>
  );
}

function Legend() {
  return (
    <div className="mx-5 mt-2 flex items-center gap-4 flex-wrap typo-label text-foreground/40">
      <span className="flex items-center gap-1.5">
        <span className="w-[18px] h-[18px] rounded-[4px] p-[2px] grid grid-cols-2 grid-rows-2 gap-[1px]" style={{ background: 'rgba(0,0,0,.25)', border: '1px solid rgba(148,163,184,.15)' }}>
          <Quad tone="crit" /><Quad tone="ok" /><Quad tone="warn" /><Quad tone="unmeasured" />
        </span>
        quadrants: errors | cost / kpi | loop
      </span>
      <span className="text-foreground/25">|</span>
      <span>rows + cells sort worst-first (triage order)</span>
      <span className="text-foreground/25">|</span>
      <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ border: `1.5px solid ${NEON.red}`, boxShadow: `0 0 5px ${NEON.red}77` }} /> red ring = regressed verdict</span>
      <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ border: `1px dashed ${CELL_HEX.unmeasured.border}` }} /> dashed = wire the sensor</span>
    </div>
  );
}

export default function CockpitSpectrum({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-spectrum">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  // Rows in triage order: the group with the worst cells first.
  const rows = [...groups].sort(
    (a, b) => Math.min(...a.cells.map((c) => RANK[dominantTone(c)])) - Math.min(...b.cells.map((c) => RANK[dominantTone(c)])),
  );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-spectrum">
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: `radial-gradient(70% 100% at 75% 0%, ${NEON.teal}09, transparent 60%)` }} />
      <GridMasthead project={project} groups={groups} />
      <Legend />
      <div className="mx-5 mt-2 relative">
        {rows.map((g, i) => <GroupRow key={g.id} group={g} index={i} />)}
      </div>
    </div>
  );
}

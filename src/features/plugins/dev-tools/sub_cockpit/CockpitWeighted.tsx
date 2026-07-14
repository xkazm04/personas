// VARIANT H — "Weighted" (R4 — named context rectangles, attention-weighted).
//
// Same group composition as Floorplan/Plates, but the LAYOUT ITSELF TRIAGES:
// a context's rectangle grows with its severity. Critical contexts are large
// tiles carrying a per-dimension readout inline; warnings are mid plates;
// healthy contexts compress into small quiet chips; unmeasured shrink to slim
// ghosts. Within a group, worst-first order — the eye lands on the problem
// because the problem is physically bigger and first.
//
// The bet vs "Plates": ATTENTION over stability. You trade spatial memory for
// an instant, ranked read of what needs you today.
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { CELL_HEX, GhostGrid, GridMasthead, MARK_LABEL, MarkGlyph, NEON, dominantTone } from './cockpitGlyphs';
import { gridFor, type CellTone, type MockContextCell, type MockContextGroup, type MockProject } from './cockpitMock';

const RANK: Record<CellTone, number> = { crit: 0, warn: 1, ok: 2, unmeasured: 3 };
const DIM_SHORT: Record<string, string> = { errors: 'err', cost: 'cost', kpi: 'kpi', loop: 'loop' };

/** The inline "why" on big tiles: which dimensions burn. */
function DimReadout({ cell }: { cell: MockContextCell }) {
  const hot = (Object.entries(cell.dims) as [string, CellTone][]).filter(([, t]) => t === 'crit' || t === 'warn');
  if (hot.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {hot.map(([d, t]) => (
        <span key={d} className="typo-label tracking-wide truncate" style={{ color: t === 'crit' ? NEON.red : NEON.amber }}>
          {DIM_SHORT[d]}
        </span>
      ))}
    </span>
  );
}

function Tile({ cell }: { cell: MockContextCell }) {
  const tone = dominantTone(cell);
  const hex = CELL_HEX[tone];

  if (tone === 'crit') {
    return (
      <button
        type="button"
        className="h-12 rounded-[6px] flex flex-col justify-center gap-0 px-2.5 min-w-0 text-left basis-[200px] grow transition-transform hover:scale-[1.03] hover:z-10 relative focus-ring"
        style={{ background: hex.fill, border: `1px solid ${hex.border}`, boxShadow: cell.mark === 'regressed' ? `0 0 10px ${NEON.red}99` : `0 0 7px ${NEON.red}55` }}
        title={`${cell.name} — critical${cell.mark ? ` · ${MARK_LABEL[cell.mark]}` : ''}`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="typo-caption font-medium text-foreground truncate">{cell.short}</span>
          <span className="ml-auto shrink-0"><MarkGlyph mark={cell.mark} /></span>
        </span>
        <DimReadout cell={cell} />
      </button>
    );
  }
  if (tone === 'warn') {
    return (
      <button
        type="button"
        className="h-9 rounded-[5px] flex items-center gap-1.5 px-2 min-w-0 text-left basis-[150px] grow-0 transition-transform hover:scale-[1.04] hover:z-10 relative focus-ring"
        style={{ background: hex.fill, border: `1px solid ${hex.border}` }}
        title={`${cell.name} — warning${cell.mark ? ` · ${MARK_LABEL[cell.mark]}` : ''}`}
      >
        <span className="typo-label text-foreground/80 truncate">{cell.short}</span>
        <span className="ml-auto shrink-0"><MarkGlyph mark={cell.mark} /></span>
      </button>
    );
  }
  if (tone === 'ok') {
    return (
      <button
        type="button"
        className="h-7 rounded-[5px] flex items-center gap-1 px-2 min-w-0 text-left basis-[104px] grow-0 transition-transform hover:scale-[1.05] hover:z-10 relative focus-ring"
        style={{ background: hex.fill, border: `1px solid ${hex.border}` }}
        title={`${cell.name} — healthy${cell.mark ? ` · ${MARK_LABEL[cell.mark]}` : ''}`}
      >
        <span className="typo-label text-foreground/60 truncate">{cell.short}</span>
        {cell.mark && <span className="ml-auto shrink-0"><MarkGlyph mark={cell.mark} /></span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="h-6 rounded-[4px] flex items-center px-2 min-w-0 text-left basis-[88px] grow-0 transition-transform hover:scale-[1.05] hover:z-10 relative focus-ring"
      style={{ border: `1px dashed ${hex.border}`, background: hex.fill }}
      title={`${cell.name} — unmeasured (wire the sensor)`}
    >
      <span className="typo-label text-foreground/30 truncate">{cell.short}</span>
    </button>
  );
}

function GroupBand({ group, index }: { group: MockContextGroup; index: number }) {
  const { shouldAnimate } = useMotion();
  const tones = group.cells.map(dominantTone);
  const crit = tones.filter((t) => t === 'crit').length;
  const warn = tones.filter((t) => t === 'warn').length;
  const worst = crit > 0 ? 'crit' : warn > 0 ? 'warn' : tones.every((t) => t === 'unmeasured') ? 'unmeasured' : 'ok';
  const lamp = worst === 'crit' ? NEON.red : worst === 'warn' ? NEON.amber : worst === 'ok' ? NEON.emerald : 'rgba(148,163,184,.4)';
  const sorted = [...group.cells].sort((a, b) => RANK[dominantTone(a)] - RANK[dominantTone(b)]);

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: 8 } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
      className="py-2.5 border-b border-foreground/[0.05] last:border-b-0"
    >
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lamp, boxShadow: worst !== 'unmeasured' ? `0 0 5px ${lamp}` : undefined }} />
        <span className="typo-label uppercase tracking-widest text-foreground/55 truncate">{group.name}</span>
        <span className="typo-label tabular-nums text-foreground/35 shrink-0">
          {crit > 0 && <span style={{ color: NEON.red }}>{crit}▲ </span>}
          {group.cells.length}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {sorted.map((c) => <Tile key={c.id} cell={c} />)}
      </div>
    </motion.div>
  );
}

export default function CockpitWeighted({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-weighted">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  // Bands in triage order too — the worst group is the first thing on screen.
  const bands = [...groups].sort(
    (a, b) => Math.min(...a.cells.map((c) => RANK[dominantTone(c)])) - Math.min(...b.cells.map((c) => RANK[dominantTone(c)])),
  );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-weighted">
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: `radial-gradient(70% 100% at 75% 0%, ${NEON.amber}07, transparent 60%)` }} />
      <GridMasthead project={project} groups={groups} />
      <div className="mx-5 mt-2 relative">
        {bands.map((g, i) => <GroupBand key={g.id} group={g} index={i} />)}
      </div>
    </div>
  );
}

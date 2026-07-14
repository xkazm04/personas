// VARIANT G — "Plates" (R4 — named context rectangles, uniform grid).
//
// Keeps Floorplan's winning composition (blocks BY GROUP, worst-tone frame +
// lamp) but every context is now a NAME-PLATE: an equal-size rectangle whose
// state reads at first sight — left state bar + background tint + one loop
// glyph — with the context's name printed ON the plate. No tooltip needed to
// know which context is in which state; the tooltip only adds detail.
//
// The bet vs "Weighted": UNIFORMITY. Equal plates in architectural order give
// calm scanning and stable spatial memory — the same context sits in the same
// place every day, and colour alone flags the change.
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { CELL_HEX, GhostGrid, GridMasthead, MARK_LABEL, MarkGlyph, NEON, dominantTone } from './cockpitGlyphs';
import { gridFor, type MockContextCell, type MockContextGroup, type MockProject } from './cockpitMock';

function Plate({ cell }: { cell: MockContextCell }) {
  const tone = dominantTone(cell);
  const hex = CELL_HEX[tone];
  const crit = tone === 'crit';
  return (
    <button
      type="button"
      className="h-8 rounded-[5px] flex items-center gap-1.5 pl-0 pr-2 min-w-0 text-left transition-transform hover:scale-[1.04] hover:z-10 relative focus-ring"
      style={{
        background: hex.fill,
        border: `1px ${tone === 'unmeasured' ? 'dashed' : 'solid'} ${hex.border}`,
        boxShadow: cell.mark === 'regressed' ? `0 0 9px ${NEON.red}88` : crit ? `0 0 6px ${NEON.red}44` : undefined,
      }}
      title={`${cell.name} — ${tone}${cell.mark ? ` · ${MARK_LABEL[cell.mark]}` : ''}`}
    >
      {/* the state bar — the first thing the eye reads */}
      <span className="self-stretch w-[3px] rounded-l-[4px] shrink-0" style={{ background: tone === 'unmeasured' ? 'transparent' : hex.border }} />
      <span className={`typo-label truncate ${tone === 'unmeasured' ? 'text-foreground/35' : 'text-foreground/80'}`}>
        {cell.short}
      </span>
      <span className="ml-auto shrink-0 flex items-center">
        <MarkGlyph mark={cell.mark} />
      </span>
    </button>
  );
}

function GroupBlock({ group, index }: { group: MockContextGroup; index: number }) {
  const { shouldAnimate } = useMotion();
  const tones = group.cells.map(dominantTone);
  const crit = tones.filter((t) => t === 'crit').length;
  const warn = tones.filter((t) => t === 'warn').length;
  const worst = crit > 0 ? 'crit' : warn > 0 ? 'warn' : tones.every((t) => t === 'unmeasured') ? 'unmeasured' : 'ok';
  const lamp = worst === 'crit' ? NEON.red : worst === 'warn' ? NEON.amber : worst === 'ok' ? NEON.emerald : 'rgba(148,163,184,.4)';

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, scale: 0.97 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
      className="rounded-card bg-black/15 p-2.5"
      style={{ border: `1px solid ${CELL_HEX[worst].border}`, boxShadow: worst === 'crit' ? `inset 0 0 18px ${NEON.red}0f` : undefined }}
    >
      <div className="flex items-center gap-1.5 mb-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lamp, boxShadow: worst !== 'unmeasured' ? `0 0 5px ${lamp}` : undefined }} />
        <span className="typo-label uppercase tracking-widest text-foreground/55 truncate">{group.name}</span>
        <span className="ml-auto typo-label tabular-nums text-foreground/35 shrink-0">
          {crit > 0 && <span style={{ color: NEON.red }}>{crit}▲ </span>}
          {group.cells.length}
        </span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}>
        {group.cells.map((c) => <Plate key={c.id} cell={c} />)}
      </div>
    </motion.div>
  );
}

export default function CockpitPlates({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-plates">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-plates">
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: `radial-gradient(70% 100% at 25% 0%, ${NEON.violet}0a, transparent 60%)` }} />
      <GridMasthead project={project} groups={groups} />
      <div className="mx-5 mt-3 grid gap-2.5 relative" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {groups.map((g, i) => <GroupBlock key={g.id} group={g} index={i} />)}
      </div>
    </div>
  );
}

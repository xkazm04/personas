// VARIANT E — "Floorplan" (R3 — the first-layer health grid).
//
// Metaphor: a CHIP DIE-MAP of the codebase. The grid is composed SPATIALLY BY
// CONTEXT GROUP: each group is a block on the die, each context a small cell
// inside it. A cell's colour is its dominant (worst-wins) health across all
// dimensions; at most one glyph marks the loop's activity on it (▼ regressed,
// ▲ moved, ● in flight, ○ proposed). Group-level status = the block's frame
// takes its worst cell's tone + a corner lamp with the count of hot cells.
//
// The question this composition answers first: WHERE in my system is it
// unhealthy? Names are tooltips; colour and position carry everything.
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import {
  CELL_HEX, GhostGrid, GridMasthead, MARK_LABEL, MarkGlyph, NEON, dominantTone,
} from './cockpitGlyphs';
import { gridFor, type MockContextCell, type MockContextGroup, type MockProject } from './cockpitMock';

function Cell({ cell }: { cell: MockContextCell }) {
  const tone = dominantTone(cell);
  const hex = CELL_HEX[tone];
  const hot = tone === 'crit';
  return (
    <button
      type="button"
      className="w-[22px] h-[22px] rounded-[4px] flex items-center justify-center transition-transform hover:scale-125 hover:z-10 relative focus-ring"
      style={{
        background: hex.fill,
        border: `1px ${tone === 'unmeasured' ? 'dashed' : 'solid'} ${hex.border}`,
        boxShadow: hot ? `0 0 6px ${NEON.red}55` : cell.mark === 'regressed' ? `0 0 8px ${NEON.red}88` : undefined,
      }}
      title={`${cell.name} — ${tone}${cell.mark ? ` · ${MARK_LABEL[cell.mark]}` : ''}`}
    >
      <MarkGlyph mark={cell.mark} />
    </button>
  );
}

function GroupBlock({ group, index }: { group: MockContextGroup; index: number }) {
  const { shouldAnimate } = useMotion();
  const tones = group.cells.map(dominantTone);
  const crit = tones.filter((t) => t === 'crit').length;
  const warn = tones.filter((t) => t === 'warn').length;
  const worst = crit > 0 ? 'crit' : warn > 0 ? 'warn' : tones.every((t) => t === 'unmeasured') ? 'unmeasured' : 'ok';
  const frame = CELL_HEX[worst].border;
  const lamp = worst === 'crit' ? NEON.red : worst === 'warn' ? NEON.amber : worst === 'ok' ? NEON.emerald : 'rgba(148,163,184,.4)';

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, scale: 0.96 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
      className="rounded-card bg-black/15 p-2.5"
      style={{ border: `1px solid ${frame}`, boxShadow: worst === 'crit' ? `inset 0 0 18px ${NEON.red}0f` : undefined }}
    >
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: lamp, boxShadow: worst !== 'unmeasured' ? `0 0 5px ${lamp}` : undefined }} />
        <span className="typo-label uppercase tracking-widest text-foreground/55 truncate">{group.name}</span>
        <span className="ml-auto typo-label tabular-nums text-foreground/35 shrink-0">
          {crit > 0 && <span style={{ color: NEON.red }}>{crit}▲ </span>}
          {group.cells.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-[3px]">
        {group.cells.map((c) => <Cell key={c.id} cell={c} />)}
      </div>
    </motion.div>
  );
}

function Legend() {
  return (
    <div className="mx-5 mt-2 flex items-center gap-4 flex-wrap typo-label text-foreground/40">
      <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ background: CELL_HEX.crit.fill, border: `1px solid ${CELL_HEX.crit.border}` }} /> critical</span>
      <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ background: CELL_HEX.warn.fill, border: `1px solid ${CELL_HEX.warn.border}` }} /> warning</span>
      <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ background: CELL_HEX.ok.fill, border: `1px solid ${CELL_HEX.ok.border}` }} /> healthy</span>
      <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-[3px]" style={{ border: `1px dashed ${CELL_HEX.unmeasured.border}` }} /> unmeasured</span>
      <span className="text-foreground/25">|</span>
      <span className="flex items-center gap-1"><MarkGlyph mark="regressed" /> regressed</span>
      <span className="flex items-center gap-1"><MarkGlyph mark="moved" /> moved</span>
      <span className="flex items-center gap-1"><MarkGlyph mark="inflight" /> in flight</span>
      <span className="flex items-center gap-1"><MarkGlyph mark="proposed" /> proposed</span>
    </div>
  );
}

export default function CockpitFloorplan({ project }: { project: MockProject }) {
  const groups = gridFor(project);
  if (project.tier === 'bare') {
    return (
      <div className="flex-1 min-h-0 flex flex-col relative" data-testid="cockpit-floorplan">
        <GridMasthead project={project} groups={groups} />
        <GhostGrid project={project} />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-8 relative" data-testid="cockpit-floorplan">
      <div className="absolute inset-x-0 top-0 h-56 pointer-events-none" style={{ background: `radial-gradient(70% 100% at 25% 0%, ${NEON.violet}0a, transparent 60%)` }} />
      <GridMasthead project={project} groups={groups} />
      <Legend />
      <div className="mx-5 mt-3 grid gap-2.5 relative" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {groups.map((g, i) => <GroupBlock key={g.id} group={g} index={i} />)}
      </div>
    </div>
  );
}

// Registry — coverage heatmap. Mental model: a GitHub-contribution field.
// Skills (rows, grouped by category, name-asc within the group) × the model's
// COLUMNS. Each filled cell takes its skill's lens colour at an intensity
// proportional to coverage, so the *shape* of adoption reads at a glance.
// Column headers run vertically to keep columns narrow (height, not width).
//
// One component, two axes (see registryTypes):
//   · workspace — columns are projects; an empty cell ADOPTS the skill there.
//   · project   — columns are that project's context groups; nothing is adopted
//     per context, so every cell DISPATCHES, and an empty one is the invitation
//     to run the skill somewhere it has not been.
//
// Pressing a column header narrows the rows to what that column holds (the
// rows fold away, the column takes a band); pressing it again — or the chip in
// the corner — restores them. Geometry and the keyboard model: heatmapKit.
import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { ArrowDownToLine, Play } from 'lucide-react';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useProgressiveReveal } from '@/hooks/utility/interaction/useProgressiveReveal';
import { MOTION } from '@/lib/utils/designTokens';
import { formatPercent } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

import { cellAlpha, HEAD_ROW, INK_VARS, LABEL_COL, LEGEND_STOPS, navId, templateFor, tint, useGridNav, type DevToolsT } from './heatmapKit';
import { RegistryHeatmapHeader } from './RegistryHeatmapHeader';
import { RegistryCategoryRow, RegistryHeatmapRow } from './RegistryHeatmapRow';
import type { RegistrySkill, SkillsRegistryProps } from '../../registryTypes';

const EASE = [0.22, 1, 0.36, 1] as const;
const STILL: Transition = { duration: 0 };

export function RegistryHeatmap({ model, adopting, onAdopt, onUse, onOpenInfo, bare = false, emptyHint }: SkillsRegistryProps & {
  /** Name click → the host's detail surface. Omitted, the name only explains itself. */
  onOpenInfo?: (skill: string) => void;
  /** Drop the card frame when the host already is one (the Dock popover). */
  bare?: boolean;
  /** Settled-empty copy, when the host knows better why there is nothing. */
  emptyHint?: string;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { columns, skills, mode } = model;
  const { shouldAnimate } = useMotion();
  const fold: Transition = useMemo(() => (shouldAnimate ? { duration: MOTION.duration.normal / 1000, ease: EASE } : STILL), [shouldAnimate]);
  const quick: Transition = useMemo(() => (shouldAnimate ? { duration: MOTION.duration.fast / 1000, ease: EASE } : STILL), [shouldAnimate]);

  // The filter is a column id; a column that leaves the model takes it along.
  const [picked, setPicked] = useState<string | null>(null);
  const filterIndex = columns.findIndex((c) => c.id === picked);
  const filterColumn = columns[filterIndex] ?? null;
  const filterId = filterColumn?.id ?? null;
  const { cell } = model;
  const matches = useCallback((s: RegistrySkill) => !filterId || cell(s.name, filterId).adopted, [filterId, cell]);
  const matchCount = useMemo(() => skills.filter(matches).length, [skills, matches]);

  // Stagger row MOUNTING: a workspace of 20 skills × 10 projects big-banged
  // 200+ interactive cells onto one frame. The reveal hands rows to the
  // renderer across a short window instead (loading-pattern v2 §3).
  const reveal = useProgressiveReveal(skills.length, { initialCount: 12, resetKey: `${mode}:${model.header?.id ?? ''}:${columns.length}` });
  const rows = useMemo(() => skills.slice(0, reveal.count).filter(matches), [skills, reveal.count, matches]);
  const lines = useMemo(() => {
    const perCat = new Map<string, number>();
    for (const s of rows) perCat.set(s.category, (perCat.get(s.category) ?? 0) + 1);
    const out: Array<{ key: string; cat: string; count: number } | { key: string; skill: RegistrySkill; r: number }> = [];
    rows.forEach((s, i) => {
      if (rows[i - 1]?.category !== s.category) out.push({ key: `cat:${s.category}`, cat: s.category, count: perCat.get(s.category) ?? 0 });
      out.push({ key: s.name, skill: s, r: i + 1 });
    });
    return out;
  }, [rows]);

  // One tab stop. The stored identity falls back to the first cell whenever
  // the thing it names is no longer on screen (filtered away, column gone).
  const nav = useGridNav(rows.length + 1, columns.length + 1);
  const [activeRow, activeCol] = (nav.active ?? '').split('::');
  const activeLive = (activeRow === HEAD_ROW ? (activeCol !== LABEL_COL || !!filterId) : rows.some((s) => s.name === activeRow))
    && (activeCol === LABEL_COL || columns.some((c) => c.id === activeCol));
  const stop = activeLive ? nav.active : rows[0] && columns[0] ? navId(rows[0].name, columns[0].id) : columns[0] ? navId(HEAD_ROW, columns[0].id) : null;
  const [stopRow, stopCol] = (stop ?? '').split('::');
  const tabFor = useCallback((id: string): 0 | -1 => (id === stop ? 0 : -1), [stop]);

  const ghost = model.loading && skills.length === 0;
  const empty = !model.loading && skills.length === 0;
  const frame = bare ? '' : 'rounded-card border border-primary/10 bg-background';

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${INK_VARS} ${frame}`} data-testid="registry-heatmap">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain scroll-pt-28">
        <div
          role="grid"
          aria-label={model.header?.name ?? d.skills_tab_registry}
          onKeyDown={nav.onKeyDown}
          onFocus={nav.onFocus}
          className="relative isolate grid w-max min-w-full"
          style={{ gridTemplateColumns: templateFor(columns.length) }}
        >
          <RegistryHeatmapHeader model={model} filterId={filterId} shownCount={matchCount} onToggle={setPicked} tabFor={tabFor} chipTransition={quick} />

          {/* Label sizer: every name, invisible and zero-height, so the label
              track is sized for the whole list from the first frame — rows
              the reveal mounts later can never widen it and shove the field. */}
          <div aria-hidden className="invisible col-start-1 flex h-0 items-center gap-2 overflow-hidden px-3">
            <span className="w-5 flex-shrink-0" />
            <span className="typo-caption flex flex-col whitespace-nowrap">{skills.map((s) => <span key={s.name}>{s.name}</span>)}</span>
            <span className="typo-label px-1.5 tabular-nums">{columns.length}/{columns.length}</span>
          </div>

          {/* The selected column's band — behind the cells, gliding between
              columns when the filter moves. Absolutely placed, so it takes no
              grid slot; the explicit `span 1` matters, because an absolute
              item's `auto` end line is the grid's padding edge, not its own. */}
          <AnimatePresence>
            {filterIndex >= 0 && (
              <motion.div
                key="band" layout="position" aria-hidden
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fold}
                className="pointer-events-none absolute inset-0 -z-10 border-x border-primary/20 bg-primary/[0.06]"
                style={{ gridColumn: `${filterIndex + 2} / span 1` }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {lines.map((line) => ('skill' in line
              ? (
                <RegistryHeatmapRow
                  key={line.key}
                  d={d}
                  skill={line.skill}
                  columns={columns}
                  cell={cell}
                  projectMode={mode === 'project'}
                  r={line.r}
                  activeCol={stopRow === line.skill.name ? (stopCol ?? null) : null}
                  adopting={adopting}
                  onAdopt={onAdopt}
                  onUse={onUse}
                  onOpenInfo={onOpenInfo}
                  transition={fold}
                />
              )
              : <RegistryCategoryRow key={line.key} label={line.cat} count={line.count} transition={fold} />))}
          </AnimatePresence>

          {ghost && <GhostRows columns={columns.length} label={t.common.loading} />}
        </div>

        {empty && (
          <div className="px-6 py-8">
            <IllustratedEmptyState variant="heatmap" heading={d.skills_registry_empty_title} description={emptyHint ?? d.skills_proj_empty} />
          </div>
        )}
        {!ghost && !empty && filterColumn && matchCount === 0 && (
          <p className="typo-caption px-6 py-8 text-center text-foreground">
            {tx(d.skills_registry_filter_empty, { name: filterColumn.name })}
          </p>
        )}
      </div>

      <Legend d={d} projectMode={mode === 'project'} />
    </div>
  );
}

/** Cold load: the header above stays; calm tiles fade in under it after a beat,
 *  on the grid's own tracks so the ghost is the shape of what is coming. */
function GhostRows({ columns, label }: { columns: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="contents">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 6 }, (_, r) => (
        <div key={r} aria-hidden className="col-span-full grid animate-fade-in grid-cols-subgrid items-center" style={{ animationDelay: `${120 + r * 35}ms` }}>
          <span className="mx-3 my-2.5 h-3.5 rounded-interactive bg-primary/[0.06]" />
          {Array.from({ length: columns }, (_, c) => <span key={c} className="mx-0.5 my-[3px] h-7 rounded-interactive bg-primary/[0.04]" />)}
        </div>
      ))}
    </div>
  );
}

function Legend({ d, projectMode }: { d: DevToolsT; projectMode: boolean }) {
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-primary/10 px-3 py-1.5 typo-label text-foreground">
      <span className="flex items-center gap-1.5">
        {d.skills_col_coverage}
        <span className="flex items-center gap-px" aria-hidden>
          {LEGEND_STOPS.map((p) => <span key={p} className="h-2.5 w-3.5 first:rounded-l-pill last:rounded-r-pill" style={{ backgroundColor: tint('var(--primary)', cellAlpha(p)) }} />)}
        </span>
        <span className="tabular-nums">{`${formatPercent(0, { precision: 0 })}–${formatPercent(100, { precision: 0 })}`}</span>
      </span>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden />{d.skills_registry_legend_recent}</span>
      <span className="flex items-center gap-1"><Play className="h-3 w-3 text-primary" aria-hidden />{d.skills_registry_legend_use}</span>
      {!projectMode && <span className="flex items-center gap-1"><ArrowDownToLine className="h-3 w-3 text-primary" aria-hidden />{d.skills_registry_legend_adopt}</span>}
    </div>
  );
}

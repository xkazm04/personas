// Registry — coverage heatmap. Mental model: a GitHub-contribution field.
// Skills (rows, grouped by category, name-asc within the group) × the model's
// COLUMNS. Each filled cell takes its skill's lens colour at an intensity
// proportional to coverage, so the *shape* of adoption reads at a glance.
// Column headers run vertically to keep columns narrow, and click to filter
// the rows to that column. Skill names show a description tooltip; the
// Registry tab also opens the shared SkillInfoModal via onOpenInfo.
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownToLine, Play } from 'lucide-react';

import { useMotionVariants, useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useProgressiveReveal } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import {
  ColHead, COL, FilterBar, HeatCell, ROW_VARIANTS, SkillName, skillTrack, withAlpha,
} from './heatmapBits';
import { cellStatus, coveragePct, type RegistrySkill, type SkillsRegistryProps } from '../../registryTypes';

export function RegistryHeatmap({
  model, adopting, onAdopt, onUse, onOpenInfo, hideUnadopted = false,
}: SkillsRegistryProps) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { columns, skills, mode } = model;
  const projectMode = mode === 'project';
  const reduceMotion = useReducedMotion();
  const rowVariants = useMotionVariants(ROW_VARIANTS);
  const [filterId, setFilterId] = useState<string | null>(null);

  const visible = useMemo(() => {
    let list = skills;
    if (hideUnadopted) list = list.filter((s) => s.adoptedCount > 0);
    if (filterId) list = list.filter((s) => model.cell(s.name, filterId).adopted);
    return list;
  }, [skills, hideUnadopted, filterId, model]);

  const reveal = useProgressiveReveal(visible.length, {
    initialCount: filterId ? visible.length : 10,
    resetKey: `${mode}:${columns.length}:${filterId ?? ''}:${hideUnadopted}`,
  });
  const grouped = useMemo(() => {
    const shown = visible.slice(0, reveal.count);
    const out: Array<{ cat: string; rows: RegistrySkill[] }> = [];
    for (const s of shown) {
      const last = out[out.length - 1];
      if (last && last.cat === s.category) last.rows.push(s);
      else out.push({ cat: s.category, rows: [s] });
    }
    return out;
  }, [visible, reveal.count]);

  const filterCol = filterId ? columns.find((c) => c.id === filterId) : undefined;
  // Size the name column from the host-visible set so toggling a column filter
  // does not reflow the grid.
  const hostSkills = hideUnadopted ? skills.filter((s) => s.adoptedCount > 0) : skills;
  const template = `${skillTrack(hostSkills.map((s) => s.name))} repeat(${columns.length}, ${COL})`;
  const underlineId = reduceMotion ? undefined : 'registry-col-sel';

  const toggleFilter = (id: string) => setFilterId((cur) => (cur === id ? null : id));

  return (
    <div className="h-full flex flex-col rounded-card border border-primary/12 bg-background overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="relative sticky top-0 z-20 border-b border-primary/10 bg-background">
          <div className="pointer-events-none absolute inset-0 bg-primary/5" />
          <div className="relative grid" style={{ gridTemplateColumns: template }}>
            <div className="relative px-3 py-2 flex items-end typo-label text-foreground sticky left-0 z-10 bg-background">
              <span className="pointer-events-none absolute inset-0 bg-primary/5" />
              <span className="relative">{d.skills_sort_skill}</span>
            </div>
            {columns.map((c) => (
              <ColHead
                key={c.id}
                column={{ ...c, color: c.color ?? model.header?.color }}
                selected={filterId === c.id}
                hint={projectMode
                  ? tx(d.skills_registry_group_hint, { name: c.name, present: c.presentCount, total: skills.length, contexts: c.units })
                  : tx(d.skills_registry_project_hint, { name: c.name, adopted: c.presentCount, total: skills.length, contexts: c.units })}
                filterAria={tx(d.skills_registry_filter_aria, { name: c.name })}
                onToggle={() => toggleFilter(c.id)}
                layoutId={underlineId}
              />
            ))}
          </div>
          <AnimatePresence initial={false}>
            {filterCol && (
              <motion.div
                key={filterCol.id}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.15 }}
                className="relative overflow-hidden"
              >
                <FilterBar
                  caption={tx(d.skills_registry_filter, { name: filterCol.name })}
                  clearLabel={d.skills_registry_filter_clear_label}
                  clearAria={d.skills_registry_filter_clear_aria}
                  onClear={() => setFilterId(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {grouped.map(({ cat, rows }) => (
          <div key={cat}>
            <div className="px-3 pt-3 pb-1 typo-label text-foreground sticky left-0 border-b border-primary/10">{cat}</div>
            <AnimatePresence initial={false}>
              {rows.map((s) => (
                <motion.div
                  key={s.name}
                  variants={rowVariants}
                  initial="hidden"
                  animate="shown"
                  exit="exit"
                  layout={!reduceMotion}
                  className="grid items-center border-b border-border/25 hover:bg-primary/[0.04] transition-colors"
                  style={{ gridTemplateColumns: template }}
                >
                  <div className="px-3 py-1.5 flex items-center gap-2 min-w-0 sticky left-0 z-10 bg-background border-r border-primary/10">
                    {s.visual && (
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
                        style={{ color: s.visual.color, borderColor: withAlpha(s.visual.color, 0.25), backgroundColor: withAlpha(s.visual.color, 0.08) }}
                      >
                        <s.visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
                      </span>
                    )}
                    <SkillName skill={s} onOpenInfo={onOpenInfo} />
                    <span className="ml-auto typo-label text-foreground tabular-nums flex-shrink-0 rounded-pill bg-secondary/60 px-1.5 leading-4">
                      {s.adoptedCount}/{columns.length}
                    </span>
                  </div>
                  {columns.map((c) => {
                    const cell = model.cell(s.name, c.id);
                    const status = cellStatus(cell, adopting, s.name, c.id);
                    const pct = coveragePct(cell, c.units);
                    return (
                      <HeatCell
                        key={c.id}
                        skillName={s.name}
                        columnId={c.id}
                        status={status}
                        pct={pct}
                        hue={s.visual?.color ?? '#6366f1'}
                        running={cell.running}
                        projectMode={projectMode}
                        selected={filterId === c.id}
                        coverageHint={tx(d.skills_registry_cell_coverage, { pct, invokes: cell.invokes30d })}
                        useLabel={tx(d.skills_registry_use_cell, { skill: s.name, project: c.name })}
                        adoptLabel={tx(d.skills_registry_adopt_cell, { skill: s.name, project: c.name })}
                        runningLabel={tx(d.skills_registry_running_cell, { skill: s.name, project: c.name })}
                        onUse={() => onUse(s.name, c.id)}
                        onAdopt={() => onAdopt(s.name, c.id)}
                      />
                    );
                  })}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-primary/10 flex-shrink-0 typo-label text-foreground bg-primary/[0.04]">
        <span className="flex items-center gap-1">
          {d.skills_col_coverage}
          {['bg-primary/20', 'bg-primary/45', 'bg-primary/70', 'bg-primary/95'].map((swatch) => (
            <span key={swatch} className={`w-3 h-3 rounded-interactive ${swatch}`} />
          ))}
        </span>
        <span className="flex items-center gap-1"><Play className="w-3 h-3" aria-hidden /> {d.skills_registry_legend_use}</span>
        {!projectMode && (
          <span className="flex items-center gap-1"><ArrowDownToLine className="w-3 h-3" aria-hidden /> {d.skills_registry_legend_adopt}</span>
        )}
      </div>
    </div>
  );
}


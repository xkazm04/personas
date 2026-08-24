// Registry — coverage heatmap. Mental model: a GitHub-contribution field.
// Skills (rows, grouped by category, name-asc within the group) × the model's
// COLUMNS. Each filled cell takes its skill's lens colour at an intensity
// proportional to coverage, so the *shape* of adoption reads at a glance.
// Column headers run vertically to keep columns narrow (height, not width).
// The skill name is a button → the shared SkillInfoModal.
//
// One component, two axes (see registryTypes):
//   · workspace — columns are projects; an empty cell ADOPTS the skill there.
//   · project   — columns are that project's context groups; nothing is adopted
//     per context, so every cell DISPATCHES, and an empty one is the invitation
//     to run the skill somewhere it has not been.
//
// Perf shape (freeze prevention): rows mount progressively (initial ~15, then
// chunked ticks), each row is a React.memo leaf carrying `content-visibility:
// auto` so offscreen rows cost no layout, and cell hover state lives inside
// the cell — see RegistryHeatmapCells.
import { useMemo } from 'react';

import { ArrowDownToLine, Play } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useProgressiveReveal } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';

import { RegistryGhosts, RegistryRow, withAlpha } from './RegistryHeatmapCells';
import type { RegistrySkill, SkillsRegistryProps } from './registryTypes';

const COL = '2.25rem';
const NEUTRAL = 'rgba(148,163,184,.9)';
const VERTICAL: React.CSSProperties = { writingMode: 'vertical-rl', transform: 'rotate(180deg)' };

export function RegistryHeatmap({ model, adopting, onAdopt, onUse, onOpenInfo }: SkillsRegistryProps & {
  onOpenInfo: (skill: string) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { columns, skills, mode } = model;
  const projectMode = mode === 'project';
  const showGhost = model.loading && skills.length === 0;

  // Stagger row MOUNTING: each row is `columns.length` tooltip-bearing cells,
  // and a workspace of 20 skills × 10 projects big-banged 200+ interactive
  // cells onto one frame. The reveal hands rows to the renderer across a
  // short window instead (loading-pattern v2 §3).
  const reveal = useProgressiveReveal(skills.length, {
    initialCount: 15,
    minChunk: 8,
    intervalMs: 80,
    resetKey: `${mode}:${columns.length}`,
  });
  const grouped = useMemo(() => {
    const shown = skills.slice(0, reveal.count);
    const out: Array<{ cat: string; rows: RegistrySkill[] }> = [];
    for (const s of shown) {
      const last = out[out.length - 1];
      if (last && last.cat === s.category) last.rows.push(s);
      else out.push({ cat: s.category, rows: [s] });
    }
    return out;
  }, [skills, reveal.count]);

  const template = `minmax(11rem,1fr) repeat(${columns.length}, ${COL})`;

  return (
    <div className="h-full flex flex-col rounded-card border border-primary/12 bg-secondary/[0.12] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto">
        {/* header — subtle primary tint (matches panel/modal headers), vertical column names */}
        <div className="grid sticky top-0 z-20 bg-primary/[0.04] backdrop-blur border-b border-primary/10" style={{ gridTemplateColumns: template }}>
          <div className="px-3 py-2 flex items-end typo-label text-foreground/40 sticky left-0 z-10 bg-primary/[0.04] backdrop-blur">{d.skills_sort_skill}</div>
          {columns.map((c) => (
            <Tooltip
              key={c.id}
              content={projectMode
                ? tx(d.skills_registry_group_hint, { name: c.name, present: c.presentCount, total: skills.length, contexts: c.units })
                : tx(d.skills_registry_project_hint, { name: c.name, adopted: c.presentCount, total: skills.length, contexts: c.units })}
              placement="top"
            >
              <div className="h-24 flex flex-col items-center justify-end gap-1.5 pb-1.5 min-w-0">
                <span className="typo-label text-foreground/55 leading-none whitespace-nowrap overflow-hidden max-h-[5rem]" style={VERTICAL}>{c.name}</span>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color ?? model.header?.color ?? NEUTRAL }} />
              </div>
            </Tooltip>
          ))}
        </div>

        {/* body — cold-load ghost under the chrome, then progressive rows */}
        {showGhost ? (
          <RegistryGhosts columns={columns.length} />
        ) : (
          grouped.map(({ cat, rows }) => (
            <div key={cat}>
              <div className="px-3 pt-3 pb-1 typo-label text-foreground/35 sticky left-0">{cat}</div>
              {rows.map((s) => (
                <RegistryRow
                  key={s.name}
                  skill={s}
                  columns={columns}
                  cellOf={model.cell}
                  adopting={adopting}
                  projectMode={projectMode}
                  template={template}
                  onAdopt={onAdopt}
                  onUse={onUse}
                  onOpenInfo={onOpenInfo}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-primary/10 flex-shrink-0 typo-label text-foreground/40">
        <span className="flex items-center gap-1">
          {d.skills_col_coverage}
          {[0.2, 0.45, 0.7, 0.95].map((a) => (
            <span key={a} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: withAlpha('#6366f1', a) }} />
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

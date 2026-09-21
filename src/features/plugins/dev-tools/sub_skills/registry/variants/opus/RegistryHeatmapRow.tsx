// A skill row and a category band — both `motion` rows, so a column filter
// FOLDS the rows it removes (height + fade) instead of snapping them out, and
// unfolds them again when the filter clears. The row is `overflow: clip`, not
// `hidden`: clip does not make it a scroll container, so the sticky label
// inside still sticks to the heatmap's scroller.
//
// The skill name explains itself on hover or focus — the shared Tooltip with
// the skill's description, in BOTH hosts. What a click adds is the host's
// call: the Registry tab passes `onOpenInfo` and the name opens the full info
// modal; the Dock picker passes nothing and the name is only a label. It used
// to pick the skill into "the most sensible project" there, which loaded a
// project the operator never pointed at — the name column is not a project.
import { memo } from 'react';
import { motion, type Transition } from 'framer-motion';
import { Wand2 } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { FOCUS, LABEL_COL, navId, tint, type DevToolsT } from './heatmapKit';
import { RegistryHeatmapCell } from './RegistryHeatmapCell';
import type { RegistryColumn, RegistryModel, RegistrySkill, SkillsRegistryProps } from '../../registryTypes';

const FOLD = { initial: { height: 0, opacity: 0 }, animate: { height: 'auto', opacity: 1 }, exit: { height: 0, opacity: 0 } };

/** Opaque, so cells scrolling under the sticky label never show through it. */
const LABEL_BG = 'bg-background group-hover/row:bg-[color-mix(in_oklab,var(--primary)_4%,var(--background))]';

type RowProps = Pick<SkillsRegistryProps, 'adopting' | 'onAdopt' | 'onUse'> & {
  d: DevToolsT;
  skill: RegistrySkill;
  /** The model's stable parts, not the model — hosts rebuild the model object
   *  on every render, and that would defeat the row memo. */
  columns: RegistryColumn[];
  cell: RegistryModel['cell'];
  projectMode: boolean;
  /** Keyboard-model row (the header is 0). */
  r: number;
  /** The column holding the grid's tab stop when it sits in THIS row, else null
   *  — so moving focus re-renders two rows, not the whole matrix. */
  activeCol: string | null;
  onOpenInfo?: (skill: string) => void;
  transition: Transition;
};

export const RegistryHeatmapRow = memo(function RegistryHeatmapRow({
  d, skill, columns, cell, projectMode, r, activeCol, adopting, onAdopt, onUse, onOpenInfo, transition,
}: RowProps) {
  return (
    <motion.div
      role="row"
      {...FOLD}
      transition={transition}
      className="group/row col-span-full grid grid-cols-subgrid items-stretch overflow-clip border-b border-primary/[0.06] transition-colors hover:bg-primary/[0.04]"
      data-testid={`registry-row-${skill.name}`}
    >
      <SkillLabel d={d} skill={skill} r={r} total={columns.length} tabIndex={activeCol === LABEL_COL ? 0 : -1} onOpenInfo={onOpenInfo} />
      {columns.map((c, j) => (
        <RegistryHeatmapCell
          key={c.id}
          d={d}
          skill={skill}
          column={c}
          cell={cell(skill.name, c.id)}
          r={r}
          c={j + 1}
          projectMode={projectMode}
          adopting={adopting}
          onAdopt={onAdopt}
          onUse={onUse}
          tabIndex={activeCol === c.id ? 0 : -1}
        />
      ))}
      <div aria-hidden />
    </motion.div>
  );
});

function SkillLabel({ d, skill: s, r, total, tabIndex, onOpenInfo }: {
  d: DevToolsT;
  skill: RegistrySkill;
  r: number;
  total: number;
  tabIndex: 0 | -1;
  onOpenInfo?: (skill: string) => void;
}) {
  const hue = s.visual?.color;
  const Icon = s.visual?.icon ?? Wand2;
  const nameClass = `typo-caption min-w-0 truncate text-left text-foreground rounded-interactive transition-colors ${FOCUS}`;
  const nav = { tabIndex, 'data-nav': navId(s.name, LABEL_COL), 'data-nav-r': r, 'data-nav-c': 0, 'data-testid': `registry-skill-${s.name}` };

  return (
    <div role="rowheader" className={`sticky left-0 z-10 flex min-w-[11rem] items-center gap-2 border-r border-primary/10 px-3 py-1 transition-colors ${LABEL_BG}`}>
      <span
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-interactive border"
        style={hue
          ? { color: hue, borderColor: tint(hue, 0.3), backgroundColor: tint(hue, 0.1) }
          : { color: 'var(--foreground)', borderColor: tint('var(--foreground)', 0.12), backgroundColor: tint('var(--foreground)', 0.04) }}
        aria-hidden
      >
        <Icon className="h-3 w-3" strokeWidth={1.75} />
      </span>
      <Tooltip
        placement="right"
        content={(
          <span className="flex max-w-[22rem] flex-col gap-1">
            <span className="typo-label text-primary">{s.visual?.label ?? s.category} · {s.name}</span>
            <span>{s.description || d.skills_confirm_no_desc}</span>
            {onOpenInfo && <span className="typo-label text-foreground">{d.skills_registry_name_details}</span>}
          </span>
        )}
      >
        {onOpenInfo
          ? <button type="button" {...nav} onClick={() => onOpenInfo(s.name)} className={`${nameClass} hover:text-primary`}>{s.name}</button>
          : <span {...nav} className={`${nameClass} cursor-default`}>{s.name}</span>}
      </Tooltip>
      <span
        className="typo-label ml-auto flex-shrink-0 rounded-pill px-1.5 tabular-nums text-foreground"
        style={{ backgroundColor: tint('var(--primary)', s.adoptedCount > 0 ? 0.12 : 0.04) }}
      >
        {s.adoptedCount}/{total}
      </span>
    </div>
  );
}

/** A category band — a row whose one header cell carries the group name. */
export function RegistryCategoryRow({ label, count, transition }: { label: string; count: number; transition: Transition }) {
  return (
    <motion.div role="row" {...FOLD} transition={transition} className="col-span-full overflow-clip">
      <div role="rowheader" className="border-b border-primary/10 pb-1 pt-3">
        <span className="sticky left-0 inline-flex items-center gap-1.5 px-3">
          <span className="typo-label text-foreground">{label}</span>
          <span className="typo-label tabular-nums text-primary">{count}</span>
        </span>
      </div>
    </motion.div>
  );
}

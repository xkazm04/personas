// One heatmap cell. Three faces:
//
//   · filled  — the skill is here. Ink = the skill's lens hue at an intensity
//     proportional to coverage, with the % printed on it, locale-formatted
//     (ink is never the only channel). A dot in the corner marks a run in the last 30 days.
//     Hover / focus swaps the % for the action glyph.
//   · empty   — a quiet dashed tile. It used to carry an always-on icon, which
//     turned the field into a wall of glyphs and drowned the one thing a
//     heatmap exists to show: the SHAPE of adoption. The affordance now
//     appears only under the pointer or the keyboard.
//   · busy    — an adoption in flight: the shared `Button`'s real spinner
//     (the pulsing tile it replaces was banned by the loading doctrine).
//
// A cell blocked by a live run stays focusable (`aria-disabled`, not
// `disabled`) so its tooltip can still say WHY it is inert.
import { ArrowDownToLine, Play } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatPercent } from '@/lib/utils/formatters';

import { cellAlpha, cellReadout, FOCUS, navId, tint, type DevToolsT } from './heatmapKit';
import {
  cellStatus, coveragePct, type RegistryCell, type RegistryColumn, type RegistrySkill, type SkillsRegistryProps,
} from './registryTypes';

type CellProps = Pick<SkillsRegistryProps, 'adopting' | 'onAdopt' | 'onUse'> & {
  /** `t.plugins.dev_tools`, handed down — one hook per grid, not one per cell. */
  d: DevToolsT;
  skill: RegistrySkill;
  column: RegistryColumn;
  cell: RegistryCell;
  /** Keyboard-model coordinate. */
  r: number;
  c: number;
  projectMode: boolean;
  tabIndex: 0 | -1;
};

export function RegistryHeatmapCell({ d, skill, column, cell, r, c, projectMode, adopting, onAdopt, onUse, tabIndex }: CellProps) {
  const status = cellStatus(cell, adopting, skill.name, column.id);
  const pct = coveragePct(cell, column.units);
  const readout = cellReadout(d, {
    skill: skill.name, column: column.name, status, projectMode, cell, units: column.units,
  });
  const testId = `registry-cell-${skill.name}-${column.id}`;
  const nav = {
    tabIndex, 'aria-label': readout.label, 'data-testid': testId,
    'data-nav': navId(skill.name, column.id), 'data-nav-r': r, 'data-nav-c': c,
  };

  let face: React.ReactNode;
  if (status === 'adopting') {
    face = <Button variant="ghost" size="icon-sm" loading aria-label={readout.label} data-testid={testId} className="mx-auto" />;
  } else if (status === 'adopted') {
    face = (
      <button
        type="button"
        {...nav}
        onClick={() => onUse(skill.name, column.id)}
        className={`group/cell relative flex h-7 w-full items-center justify-center rounded-interactive transition-[filter] hover:brightness-110 ${FOCUS} ${
          cell.running ? 'ring-1 ring-inset ring-status-info' : ''
        }`}
        style={{ backgroundColor: tint(skill.visual?.color ?? 'var(--primary)', cellAlpha(pct)) }}
      >
        <span className="typo-label tabular-nums text-foreground group-hover/cell:hidden group-focus-visible/cell:hidden">
          {formatPercent(pct, { precision: 0 })}
        </span>
        <Play className="hidden h-3.5 w-3.5 text-foreground group-hover/cell:block group-focus-visible/cell:block" aria-hidden />
        {cell.invokes30d > 0 && <span className="absolute right-[3px] top-[3px] h-1 w-1 rounded-full bg-foreground" aria-hidden />}
      </button>
    );
  } else {
    const blocked = status === 'blocked';
    const Glyph = projectMode ? Play : ArrowDownToLine;
    face = (
      <button
        type="button"
        {...nav}
        aria-disabled={blocked || undefined}
        onClick={blocked ? undefined : () => (projectMode ? onUse : onAdopt)(skill.name, column.id)}
        className={`group/cell flex h-7 w-full items-center justify-center rounded-interactive border border-dashed text-primary transition-colors ${FOCUS} ${
          blocked
            ? 'cursor-not-allowed border-status-info/40'
            : "border-primary/15 [[data-theme^='light']_&]:border-primary/30 hover:border-primary/45 hover:bg-primary/[0.07] focus-visible:bg-primary/[0.07]"
        }`}
      >
        {blocked
          ? <span className="h-1.5 w-1.5 rounded-full bg-status-info" aria-hidden />
          : <Glyph className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" aria-hidden />}
      </button>
    );
  }

  return (
    <div role="gridcell" className="flex items-center px-0.5 py-[3px]">
      <Tooltip
        content={(
          <span className="flex flex-col gap-0.5">
            <span>{readout.action}</span>
            {readout.facts && <span className="typo-label text-primary">{readout.facts}</span>}
          </span>
        )}
      >
        {face}
      </Tooltip>
    </div>
  );
}

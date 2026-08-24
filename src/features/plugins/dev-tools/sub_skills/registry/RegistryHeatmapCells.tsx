// Registry heatmap leaves — memoized row + cell, plus the cold-load ghost.
// Extracted from RegistryHeatmap so each row/cell can be React.memo'd with
// stable props: the grid is skills × columns of tooltip-bearing buttons, and
// before this split one hover `useState` at the heatmap level re-rendered
// every cell in the matrix on each mouse move. Hover now lives inside the one
// cell it affects, and each row derives its cell statuses once per data
// change (useMemo) instead of per cell render.
import { memo, useMemo, useState } from 'react';

import { ArrowDownToLine, Play } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import {
  cellStatus, coveragePct,
  type CellStatus, type RegistryCell, type RegistryColumn, type RegistryModel, type RegistrySkill,
} from './registryTypes';

/** hex (#RRGGBB) → rgba with the given alpha. */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const CELL_FRAME = 'h-8 mx-0.5 my-0.5 rounded-interactive flex items-center justify-center transition-colors';
// muted-ok: dashed placeholder-cell glyph — an empty-cell affordance (chrome), not body copy
const CELL_DASHED = `${CELL_FRAME} border border-dashed border-primary/15 text-foreground/30 hover:text-primary hover:border-primary/40 hover:bg-primary/[0.06] disabled:cursor-not-allowed`;

interface HeatmapCellProps {
  skillName: string;
  column: RegistryColumn;
  cell: RegistryCell;
  status: CellStatus;
  pct: number;
  hue: string;
  projectMode: boolean;
  onAdopt: (skill: string, columnId: string) => void;
  onUse: (skill: string, columnId: string) => void;
}

const HeatmapCell = memo(function HeatmapCell({
  skillName, column, cell, status, pct, hue, projectMode, onAdopt, onUse,
}: HeatmapCellProps) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [hover, setHover] = useState(false);
  const testId = `registry-cell-${skillName}-${column.id}`;

  if (status === 'adopted') {
    return (
      <button type="button"
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={() => onUse(skillName, column.id)}
        aria-label={tx(d.skills_registry_use_cell, { skill: skillName, project: column.name })}
        className={`relative ${CELL_FRAME} ${cell.running ? 'ring-2 ring-status-info/60' : ''}`}
        style={{ backgroundColor: withAlpha(hue, 0.15 + (pct / 100) * 0.55) }}
        data-testid={testId}
      >
        {hover
          ? <Play className="w-3.5 h-3.5 text-foreground" aria-hidden />
          : <span className="typo-label tabular-nums text-foreground/90">{pct}%</span>}
        {cell.invokes30d > 0 && !hover && (
          // muted-ok: micro invoke-count badge in the cell corner (chrome), not body copy
          <span className="absolute bottom-0 right-0.5 typo-label text-foreground/40 leading-none" style={{ fontSize: '0.55rem' }}>{cell.invokes30d}</span>
        )}
      </button>
    );
  }

  // Untouched cell. In project mode this is not "missing" — the skill is
  // installed, it just has not run in that part of the repo yet — so it stays
  // a dispatch, never an adopt.
  if (projectMode) {
    return (
      <button type="button"
        onClick={() => onUse(skillName, column.id)}
        disabled={cell.running}
        aria-label={tx(d.skills_registry_use_cell, { skill: skillName, project: column.name })}
        className={`${CELL_DASHED} ${cell.running ? 'opacity-30 animate-pulse' : ''}`}
        data-testid={testId}
      >
        <Play className="w-3.5 h-3.5" aria-hidden />
      </button>
    );
  }

  const busy = status === 'adopting';
  const blocked = status === 'blocked';
  return (
    <button type="button"
      disabled={busy || blocked}
      onClick={() => onAdopt(skillName, column.id)}
      aria-label={blocked
        ? tx(d.skills_registry_running_cell, { skill: skillName, project: column.name })
        : tx(d.skills_registry_adopt_cell, { skill: skillName, project: column.name })}
      className={`${CELL_DASHED} ${busy ? 'animate-pulse opacity-60 border-solid border-primary/40 text-primary' : ''} ${blocked ? 'opacity-30' : ''}`}
      data-testid={testId}
    >
      <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
});

interface RegistryRowProps {
  skill: RegistrySkill;
  columns: RegistryColumn[];
  cellOf: RegistryModel['cell'];
  adopting: Set<string>;
  projectMode: boolean;
  template: string;
  onAdopt: (skill: string, columnId: string) => void;
  onUse: (skill: string, columnId: string) => void;
  onOpenInfo: (skill: string) => void;
}

/** One heatmap row. `content-visibility: auto` lets the browser skip layout +
 *  paint for rows scrolled out of the matrix viewport (ScheduleRow precedent);
 *  the intrinsic size matches the fixed cell height (h-8 + my-0.5 = 36px). */
export const RegistryRow = memo(function RegistryRow({
  skill: s, columns, cellOf, adopting, projectMode, template, onAdopt, onUse, onOpenInfo,
}: RegistryRowProps) {
  const cells = useMemo(
    () => columns.map((c) => {
      const cell = cellOf(s.name, c.id);
      return { column: c, cell, status: cellStatus(cell, adopting, s.name, c.id), pct: coveragePct(cell, c.units) };
    }),
    [columns, cellOf, adopting, s.name],
  );
  return (
    <div
      className="grid items-center hover:bg-primary/[0.03] [content-visibility:auto] [contain-intrinsic-size:auto_36px]"
      style={{ gridTemplateColumns: template }}
    >
      {/* skill label (sticky) — click opens the info modal */}
      <div className="px-3 py-1 flex items-center gap-2 min-w-0 sticky left-0 z-10 bg-secondary/[0.12] backdrop-blur">
        {s.visual && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-interactive border flex-shrink-0"
            style={{ color: s.visual.color, borderColor: withAlpha(s.visual.color, 0.25), backgroundColor: withAlpha(s.visual.color, 0.08) }}>
            <s.visual.icon className="w-3 h-3" aria-hidden strokeWidth={1.75} />
          </span>
        )}
        <button type="button" onClick={() => onOpenInfo(s.name)}
          className="typo-caption font-normal text-foreground truncate text-left hover:text-primary transition-colors"
          data-testid={`registry-skill-${s.name}`}>
          {s.name}
        </button>
        {/* muted-ok: adopted-count micro chip beside the name (chrome), not body copy */}
        <span className="ml-auto typo-label text-foreground/35 tabular-nums flex-shrink-0">{s.adoptedCount}/{columns.length}</span>
      </div>
      {cells.map(({ column, cell, status, pct }) => (
        <HeatmapCell key={column.id} skillName={s.name} column={column} cell={cell} status={status} pct={pct}
          hue={s.visual?.color ?? '#6366f1'} projectMode={projectMode} onAdopt={onAdopt} onUse={onUse} />
      ))}
    </div>
  );
});

/** Geometry-matched ghost rows for the matrix cold load (loading pattern v2:
 *  calm fade-in under the always-rendered chrome, no spinner). */
export function RegistryGhosts({ columns }: { columns: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-1 p-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-1 animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }}>
          <div className="w-44 h-7 rounded-interactive bg-primary/[0.06]" />
          {Array.from({ length: Math.max(1, Math.min(columns, 12)) }, (_, j) => (
            <div key={j} className="w-8 h-7 rounded-interactive bg-primary/[0.06]" />
          ))}
        </div>
      ))}
    </div>
  );
}

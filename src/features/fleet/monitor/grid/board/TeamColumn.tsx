// TeamColumn — one team's column: a pinned header over its own scroller.
//
// THE HEADER IS THE SCOPE CONTROL. The tooltip carries what the click does as
// well as the full name — the name is the one thing here that can truncate, and
// a control whose only affordance is a hover colour has to say what it does
// somewhere. Shared `Tooltip`, not `title=`, so it is reachable by keyboard and
// touch.
//
// At square width this header was an initials chip with no roster count, "kept
// deliberately minimal" because 38px had room for nothing else. The constraint
// that motivated that is gone: the column is a tile wide, so the team gets its
// real name and its headcount. It sits ABOVE the column's own scroller rather
// than `sticky` against a shared one — the same property, held structurally
// (see `ColumnBody`'s header for the two-axis geometry decision).
//
// THE COLUMN IS CONTENT-SIZED, not `h-full`. The board wraps into rows
// (`gridGeometry`'s "board's own wrap"), so a row's height is its tallest
// column and a column that stretched would make every row the height of the
// display. Its body is capped instead — one large team scrolls inside its own
// column rather than pushing its four neighbours off the screen.

import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Power, PowerOff } from 'lucide-react';
import { ContextMenu } from '@/features/shared/components/overlays/ContextMenu';
import {
  useProjectForTeam, useToggleProject,
} from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { cleanName } from '../fleetGridModel';
import { ColumnBody } from '../ColumnBody';
import { ColumnGhost } from '../BoardGhost';
import { COLUMN_BODY_MAX_H, type ColumnRow } from '../gridGeometry';
import type { BoardColumn } from '../useBoardModel';

export function TeamColumn({
  column, scoped, onToggleScope, width, renderRow, focusKey, staged, reducedMotion,
}: {
  column: BoardColumn;
  scoped: boolean;
  onToggleScope: (teamId: string, teamName: string, roster: BoardColumn['cards']) => void;
  /** The row's measured column width (`gridGeometry`'s width ladder), never
   *  narrower than the node. The tiles inside are rendered at the same number,
   *  so the section and its contents cannot disagree. */
  width: number;
  renderRow: (row: ColumnRow) => ReactNode;
  focusKey: string | null;
  /** The tiles' stage has arrived; until then the column shows its own ghost. */
  staged: boolean;
  reducedMotion: boolean;
}) {
  const { t, tx } = useTranslation();
  const name = cleanName(column.teamName);
  // THE PROJECT SWITCH lives on the header's right-click. Off overrules every
  // persona in the column: the backend starts none of them, and the column
  // steps back so the board says so without opening anything.
  const project = useProjectForTeam(column.teamId);
  const projectOff = project !== null && !project.enabled;
  const toggleProject = useToggleProject();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (!project) return; // a team with no project has no switch
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <section
      className="flex min-h-0 flex-shrink-0 flex-col gap-1.5"
      style={{ width }}
      data-testid="fleet-grid-column"
    >
      <div className="flex flex-shrink-0 flex-col gap-1 pb-2 pt-0.5">
        <Tooltip
          content={projectOff
            ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
            : tx(t.monitor.grid_column_scope, { project: name })}
        >
          <button
            type="button"
            onClick={() => onToggleScope(column.teamId, column.teamName, column.cards)}
            onContextMenu={onContextMenu}
            aria-pressed={scoped}
            data-project-off={projectOff || undefined}
            data-testid="fleet-grid-column-header"
            className={`focus-ring flex w-full items-baseline gap-1.5 rounded-interactive px-1 py-0.5 text-left transition-colors ${
              scoped ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-secondary/40'
            }`}
          >
            <span className={`min-w-0 flex-1 truncate typo-label ${projectOff ? 'opacity-55' : ''}`}>{name}</span>
            {projectOff && (
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-status-warning/30 bg-status-warning/10 px-1.5 typo-caption text-status-warning">
                <PowerOff className="h-2.5 w-2.5" aria-hidden />
                {t.plugins.dev_projects.project_state_off}
              </span>
            )}
            <span className="flex-shrink-0 typo-caption tabular-nums opacity-50">
              {column.cards.length}
            </span>
          </button>
        </Tooltip>
        <span
          aria-hidden
          className="h-0.5 w-full rounded-full"
          style={{ backgroundColor: colorWithAlpha(column.teamColor, 0.55) }}
        />
      </div>

      {/* Roster + sessions — one windowed stack of rows. On the session's first
          paint the rows wait one frame behind their own geometry-matched ghost,
          then arrive with a short rise: data landing reads as data landing, not
          as a ghost being swapped for a board. Reduced motion opts out. */}
      {staged ? (
        <motion.div
          className="flex min-h-0 flex-col"
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          {/* Dimmed on an inner box: motion owns the outer opacity. */}
          <div className={`flex min-h-0 flex-col transition-opacity ${projectOff ? 'opacity-45 grayscale' : ''}`}>
            <ColumnBody
              rows={column.rows}
              renderRow={renderRow}
              focusKey={focusKey}
              maxHeight={COLUMN_BODY_MAX_H}
            />
          </div>
        </motion.div>
      ) : (
        <ColumnGhost rows={column.rows.length} maxHeight={COLUMN_BODY_MAX_H} width={width} />
      )}
      {menu && project && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          ariaLabel={name}
          widthClass="w-52"
          items={[{
            id: 'toggle-project',
            label: project.enabled ? t.plugins.dev_projects.project_switch_off : t.plugins.dev_projects.project_switch_on,
            icon: project.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />,
            onSelect: () => { void toggleProject(project); },
          }]}
        />,
        document.body,
      )}
    </section>
  );
}

export default TeamColumn;

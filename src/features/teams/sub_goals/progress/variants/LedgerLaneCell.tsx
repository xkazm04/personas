/**
 * The ledger's milestone cell: the one place in the table that is a canvas.
 *
 * It is the drop target for its row's goal, the right-click door to the move
 * menu, and the only cell that stops its click from reaching the table's
 * `onRowClick` - acting on the cut must not also open the goal drawer.
 *
 * An unbound goal shows a dashed slot rather than an empty cell: an empty cell
 * says "no data", and a dashed slot says "nothing committed yet, put something
 * here", which is the true state.
 */
import { Flag } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { useProgressView } from '../canvasHost';
import { laneTone, useMenuKey } from '../rowCanvas';
import type { LedgerRow } from './LedgerCanvas';

export function LedgerLaneCell({ row }: { row: LedgerRow }) {
  const { t } = useTranslation();
  const { canvas } = useProgressView();
  const lane = row.lane;
  const target = lane
    ? ({ kind: 'milestone', milestoneId: lane.id, name: lane.name } as const)
    : ({ kind: 'goal', goalId: row.node.goal.id, projectId: row.projectId, name: row.node.goal.title } as const);
  const { onKeyDown, onContextMenu } = useMenuKey((e) => canvas.openMenu(e, target));

  const key = lane ? `ledger:${lane.id}:${row.node.goal.id}` : `ledger:none:${row.node.goal.id}`;
  const over = canvas.drop.overKey === key;
  const tone = laneTone(lane?.status ?? 'planned');

  return (
    <span
      {...canvas.drop.propsFor(key, lane?.id ?? null)}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      tabIndex={0}
      role="group"
      aria-label={lane ? lane.name : t.ship.unassigned}
      data-testid={`ledger-lane-${row.node.goal.id}`}
      className={`inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-input border px-1.5 py-0.5 focus-ring transition-colors ${
        lane ? tone.border : 'border-dashed border-primary/20'
      } ${over ? `${tone.bg} ring-1 ring-inset ${tone.border}` : ''}`}
    >
      {lane ? (
        <>
          <Flag className={`w-3 h-3 shrink-0 ${tone.text}`} aria-hidden />
          <span className={`typo-caption truncate ${tone.text}`}>{lane.name}</span>
        </>
      ) : (
        <span className="typo-caption text-foreground">{t.ship.unassigned}</span>
      )}
    </span>
  );
}

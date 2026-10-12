/**
 * DeckLaneBoard — the lanes, as columns, inside the dispatch modal.
 *
 * One column per strand the executor will run (`dev_tools_start_batch`'s
 * `lanes`, see `useAcceptedDispatch`'s header for why that number finally
 * means something). A column is an ordered list: the executor runs its tasks
 * top to bottom and pulls the next one only when the previous has finished,
 * which is the operator's "each lane reorders to last position after each
 * task" read as a worker pool rather than as a shuffle.
 *
 * **Drag is the platform's, not a library's.** `draggable` + `dataTransfer`
 * carries the idea id; there is no DnD dependency here and no hand-rolled
 * pointer tracking. It is also never the ONLY way to assign — every row in
 * the work list carries a select, because a drag is unreachable by keyboard
 * and this is the last gate before the reviewer spends money.
 */
import { memo } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { useTranslation } from '@/i18n/useTranslation';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

import { MAX_PARALLEL, MIN_PARALLEL, type LaneAssignments } from './useAcceptedDispatch';

/** The id a drag carries. A bare `text/plain` would also be dropped by any
 *  text field the pointer passes over, so the payload is typed. */
const DRAG_TYPE = 'application/x-personas-idea-id';

export interface DeckLaneBoardProps {
  lanes: number;
  setLanes: (n: number) => void;
  /** The selected rows, in the order the work list shows them. */
  picked: UndispatchedIdea[];
  assignments: LaneAssignments;
  assign: (id: string, lane: number | null) => void;
  disabled: boolean;
}

export const DeckLaneBoard = memo(function DeckLaneBoard({
  lanes,
  setLanes,
  picked,
  assignments,
  assign,
  disabled,
}: DeckLaneBoardProps) {
  const { t, tx } = useTranslation();
  const m = t.monitor;

  const columns = Array.from({ length: lanes }, (_, lane) =>
    picked.filter((row) => assignments.get(row.id) === lane),
  );
  const unpinned = picked.filter((row) => assignments.get(row.id) === undefined);

  const drop = (lane: number) => (event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (id) assign(id, lane);
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="typo-label text-foreground">{m.triage_dispatch_lanes_heading}</span>
        <NumberStepper
          value={lanes}
          onChange={(n) => setLanes(n ?? MIN_PARALLEL)}
          min={MIN_PARALLEL}
          max={MAX_PARALLEL}
          ariaLabel={m.triage_dispatch_lane_count}
          disabled={disabled}
          className="w-[74px] shrink-0"
        />
        <span className="ml-auto typo-caption">
          {lanes === MIN_PARALLEL
            ? m.triage_dispatch_sequential
            : tx(m.triage_dispatch_unpinned_count, { count: unpinned.length })}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-y-auto">
        {columns.map((column, lane) => (
          <section
            key={lane}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop(lane)}
            aria-label={tx(m.triage_dispatch_lane_name, { n: lane + 1 })}
            className="flex min-h-[7rem] flex-col gap-1 rounded-card border border-border bg-secondary/20 p-2"
          >
            <header className="flex items-center justify-between">
              <span className="typo-label text-foreground">
                {tx(m.triage_dispatch_lane_name, { n: lane + 1 })}
              </span>
              <span className="typo-caption tabular-nums">{column.length}</span>
            </header>
            {column.length === 0 ? (
              <p className="typo-caption">{m.triage_dispatch_lane_empty}</p>
            ) : (
              <ol className="flex min-w-0 flex-col gap-1">
                {column.map((row, index) => (
                  <li
                    key={row.id}
                    className="flex min-w-0 items-center gap-1 rounded-interactive bg-background/60 px-1.5 py-1"
                  >
                    <span className="typo-caption tabular-nums text-primary">{index + 1}</span>
                    <span className="typo-caption min-w-0 flex-1 truncate text-foreground">
                      {row.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tx(m.triage_dispatch_unpin, { title: row.title })}
                      disabled={disabled}
                      onClick={() => assign(row.id, null)}
                      icon={<X className="h-3 w-3" />}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
});

export { DRAG_TYPE };

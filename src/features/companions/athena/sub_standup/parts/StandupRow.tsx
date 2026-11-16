import { memo } from 'react';

import type { RowView } from '../model/types';
import type { Axes } from './axis';
import { DecisionCell, NameCell, TodayCell, TonightCell } from './cells';

interface Props {
  row: RowView;
  index: number;
  selected: boolean;
  axes: Axes;
  rug: boolean;
  /** Select the row and open its decision modal. */
  onOpen: (index: number) => void;
}

/**
 * One standup line: name | today | decision | tonight on the page's one grid.
 * Memoised, so moving the cursor re-renders only the two rows whose
 * `selected` flipped. A click selects the row and opens its decision modal.
 */
export const StandupRow = memo(function StandupRow({ row, index, selected, axes, rug, onOpen }: Props) {
  return (
    <div
      id={`sc-row-${row.key}`}
      role="option"
      aria-selected={selected}
      data-testid={`standup-row-${row.key}`}
      data-state={row.state}
      className={`sc-row sc-grid ${selected ? 'is-sel' : ''}`}
      onClick={() => onOpen(index)}
    >
      <NameCell row={row} />
      <TodayCell row={row} axes={axes} rug={rug} />
      <DecisionCell row={row} />
      <TonightCell row={row} axes={axes} />
    </div>
  );
});

import { memo } from 'react';

import type { RowView } from '../../model/types';
import type { Axes } from './axis';
import { DecisionCell, NameCell, TodayCell, TonightCell } from './cells';
import type { RowActions } from './rowActions';
import { RowDetail } from './RowDetail';

interface Props {
  row: RowView;
  index: number;
  selected: boolean;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  axes: Axes;
  rug: boolean;
  act: RowActions;
  onSelect: (index: number) => void;
}

/**
 * One timetable line: name | today | decision | tonight on the page's one grid.
 * Memoised, so moving the cursor re-renders only the two rows whose
 * `selected` flipped. The selected row opens its detail under columns 2-4.
 */
export const EditorialRow = memo(function EditorialRow({ row, index, selected, editable, typing, proposing, axes, rug, act, onSelect }: Props) {
  return (
    <div
      id={`se-row-${row.key}`}
      role="option"
      aria-selected={selected}
      data-testid={`standup-row-${row.key}`}
      data-state={row.state}
      className={`se-row se-grid ${selected ? 'is-sel' : ''}`}
      onClick={() => onSelect(index)}
    >
      <NameCell row={row} />
      <TodayCell row={row} axes={axes} rug={rug} />
      <DecisionCell row={row} proposing={proposing} />
      <TonightCell row={row} axes={axes} />
      {selected && <RowDetail row={row} editable={editable} typing={typing} proposing={proposing} act={act} />}
    </div>
  );
});

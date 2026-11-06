import { memo, useCallback } from 'react';

import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { RowView } from '../model/types';
import { NameCell, NightCell, NowCell, PastCell } from './RowCells';
import { RowExpand } from './RowExpand';

export interface RowProps {
  row: RowView;
  index: number;
  revealOrder: number;
  selected: boolean;
  editable: boolean;
  typing: boolean;
  proposing: boolean;
  nowPos: number | null;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
  onSelect: (index: number) => void;
  onPick: (row: RowView, index: number) => void;
  onTyped: (row: RowView, text: string | null) => void;
}

/**
 * One project (or agent change, or held ask) as one line through today, now
 * and tonight. Memoised: moving the selection re-renders only the two rows
 * whose `selected` flipped, never the table.
 */
export const StandupRow = memo(function StandupRow(p: RowProps) {
  const { row, index, onSelect, onPick, onTyped } = p;
  const select = useCallback(() => onSelect(index), [onSelect, index]);
  const pick = useCallback((i: number) => onPick(row, i), [onPick, row]);
  const typed = useCallback((text: string | null) => onTyped(row, text), [onTyped, row]);
  return (
    <RevealItem
      revealId={row.key}
      order={p.revealOrder}
      hasEntered={p.hasEntered}
      markEntered={p.markEntered}
      id={`su-row-${row.key}`}
      role="option"
      aria-selected={p.selected}
      data-testid={`standup-row-${row.key}`}
      data-state={row.state}
      className={`su-row su-grid ${p.selected ? 'is-sel' : ''}`}
      onClick={select}
    >
      <NameCell row={row} />
      <PastCell row={row} />
      <NowCell row={row} proposing={p.proposing} />
      <NightCell row={row} nowPos={p.nowPos} />
      <RowExpand
        row={row}
        open={p.selected}
        editable={p.editable}
        typing={p.typing}
        proposing={p.proposing}
        onPick={pick}
        onTyped={typed}
      />
    </RevealItem>
  );
});

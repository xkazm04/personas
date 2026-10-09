// PROTOTYPE ROUND (spark council-readout), direction C. The table's keys and
// double click, delegated from the scroller to the row under the event: the
// kit's DataTable owns the row (its roving tab stop, its click), this owns
// what the panel adds - arrows move the selection, Enter or a double click
// opens the council. The selected row is kept in view and keeps the focus.
import { useCallback, useEffect, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import type { PanelRow } from '../../protoModel';

const ROW = 'tr[data-id]';

function rowId(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest(ROW)?.getAttribute('data-id') ?? null) : null;
}

export function useRowKeys({
  rows,
  selectedId,
  onSelect,
  onOpen,
  scrollerRef,
}: {
  rows: PanelRow[];
  selectedId: string | null;
  onSelect: (subject: CouncilSubjectState) => void;
  onOpen: (subject: CouncilSubjectState) => void;
  scrollerRef: RefObject<HTMLElement | null>;
}) {
  const find = useCallback((id: string | null) => rows.find((r) => r.subject.id === id) ?? null, [rows]);

  // The selected row stays in view, and takes the focus when the focus was
  // already inside the table (so the arrows keep walking it).
  useEffect(() => {
    const box = scrollerRef.current;
    if (!box || !selectedId) return;
    const tr = box.querySelector<HTMLElement>(`${ROW}[data-id="${CSS.escape(selectedId)}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: 'nearest' });
    if (box.contains(document.activeElement) && document.activeElement !== tr) tr.focus({ preventScroll: true });
  }, [selectedId, scrollerRef, rows]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const id = rowId(e.target);
      if (!id || !(e.target instanceof HTMLTableRowElement)) return;
      const at = rows.findIndex((r) => r.subject.id === id);
      let next: PanelRow | undefined;
      if (e.key === 'ArrowDown') next = rows[Math.min(rows.length - 1, at + 1)];
      else if (e.key === 'ArrowUp') next = rows[Math.max(0, at - 1)];
      else if (e.key === 'Home') next = rows[0];
      else if (e.key === 'End') next = rows[rows.length - 1];
      else if (e.key === 'Enter') {
        const row = find(id);
        if (row) onOpen(row.subject);
      } else if (e.key === ' ') {
        const row = find(id);
        if (row) onSelect(row.subject);
      } else return;
      e.preventDefault();
      // The stage's own arrows walk the nested list; inside the table they are ours.
      e.stopPropagation();
      if (next && next.subject.id !== selectedId) onSelect(next.subject);
    },
    [rows, find, onOpen, onSelect, selectedId],
  );

  const onDoubleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const row = find(rowId(e.target));
      if (row) onOpen(row.subject);
    },
    [find, onOpen],
  );

  return { onKeyDown, onDoubleClick };
}

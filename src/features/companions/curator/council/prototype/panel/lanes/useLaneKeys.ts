// PROTOTYPE ROUND (spark council-readout), direction D. The lanes' keys:
// the rows are ONE listbox across every lane, so the arrows walk straight
// through lane heads; Enter opens the council, Space selects it. The
// selected row stays in view and keeps the focus while the focus is inside.
import { useCallback, useEffect, type KeyboardEvent, type RefObject } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import type { PanelRow } from '../../protoModel';

export function useLaneKeys({
  rows,
  selectedId,
  onSelect,
  onOpen,
  listRef,
}: {
  rows: PanelRow[];
  selectedId: string | null;
  onSelect: (subject: CouncilSubjectState) => void;
  onOpen: (subject: CouncilSubjectState) => void;
  listRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const list = listRef.current;
    if (!list || !selectedId) return;
    const el = list.querySelector<HTMLElement>(`[role="option"][data-id="${CSS.escape(selectedId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    if (list.contains(document.activeElement) && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [selectedId, listRef, rows]);

  return useCallback(
    (e: KeyboardEvent<HTMLElement>, row: PanelRow) => {
      const at = rows.indexOf(row);
      let next: PanelRow | undefined;
      if (e.key === 'ArrowDown') next = rows[Math.min(rows.length - 1, at + 1)];
      else if (e.key === 'ArrowUp') next = rows[Math.max(0, at - 1)];
      else if (e.key === 'Home') next = rows[0];
      else if (e.key === 'End') next = rows[rows.length - 1];
      else if (e.key === 'Enter') onOpen(row.subject);
      else if (e.key === ' ') onSelect(row.subject);
      else return;
      e.preventDefault();
      // The stage's own arrows walk the nested list; inside the lanes they are ours.
      e.stopPropagation();
      if (next && next.subject.id !== selectedId) onSelect(next.subject);
    },
    [rows, selectedId, onOpen, onSelect],
  );
}

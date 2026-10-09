// PROTOTYPE ROUND (spark council-readout). The ledger's keyboard: the list is
// ONE listbox, so arrows move the selection, Home/End jump, Enter opens. The
// keys stop at the list so the stage's own arrows (the nested list on the
// left) do not move at the same time.
import { useCallback, useEffect, type KeyboardEvent } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import type { PanelRow } from '../../protoModel';

/** Breathing room kept above and below a row scrolled into view. */
const MARGIN = 10;

/**
 * Bring the selected row into its list's view, top first. Scrolls the LIST
 * only: `scrollIntoView` would also scroll the stage, which clips but is
 * still programmatically scrollable.
 */
function reveal(el: HTMLElement, list: HTMLElement): void {
  const lr = list.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (er.top < lr.top + MARGIN) list.scrollTop -= lr.top + MARGIN - er.top;
  else if (er.bottom > lr.bottom - MARGIN) list.scrollTop += Math.min(er.bottom - lr.bottom + MARGIN, er.top - lr.top - MARGIN);
}

export function useLedgerKeys(
  rows: PanelRow[],
  selectedId: string | null,
  onSelect: (subject: CouncilSubjectState) => void,
  onOpen: (subject: CouncilSubjectState) => void,
  idOf: (subjectId: string) => string,
): (e: KeyboardEvent<HTMLElement>) => void {
  // The selected row stays in view however it was selected (keys, the stage,
  // `W`), again once its round is read and it opens to its full height, and
  // whenever the list itself is resized - the dock eases in under the column
  // AFTER the first reveal and would otherwise cover the row's lower half.
  const opened = rows.some((r) => r.subject.id === selectedId && r.seats != null);
  useEffect(() => {
    if (!selectedId) return;
    const el = document.getElementById(idOf(selectedId));
    const list = el?.closest<HTMLElement>('[role="listbox"]');
    if (!el || !list) return;
    reveal(el, list);
    const observer = new ResizeObserver(() => reveal(el, list));
    observer.observe(list);
    return () => observer.disconnect();
  }, [selectedId, opened, idOf]);

  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (!rows.length) return;
      const at = rows.findIndex((r) => r.subject.id === selectedId);
      const last = rows.length - 1;
      let next: number | null = null;
      if (e.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(last, at + 1);
      else if (e.key === 'ArrowUp') next = at < 0 ? last : Math.max(0, at - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else if (e.key === 'Enter') {
        const row = rows[at];
        if (row) onOpen(row.subject);
      } else return;
      e.preventDefault();
      e.stopPropagation();
      const row = next == null ? null : rows[next];
      if (row && next !== at) onSelect(row.subject);
    },
    [rows, selectedId, onSelect, onOpen],
  );
}

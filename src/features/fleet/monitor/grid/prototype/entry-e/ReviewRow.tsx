// The Reviews tab's row: the baseline rail row (`RailRowView`), not the desk's
// lamp window. The owner judged the baseline's review row the better UX - a
// full-width title line, the source beneath it and the two verdict buttons in
// reach on every row - so the desk wears it as-is and only adds the keys its
// footer promises (A approve, R reject, arrows walk, Enter opens), which the
// baseline row never answered to.

import { memo, type KeyboardEvent } from 'react';
import { RailRowView } from '../../rail/RailRowView';
import type { RailRow } from '../../rail/railModel';

export { railRowHeight as reviewRowHeight } from '../../rail/RailRowView';

export const ReviewRow = memo(function ReviewRow({
  row, onOpen, onAccept, onReject,
}: {
  row: RailRow;
  onOpen: (row: RailRow) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only the focused row itself - never a key typed into one of its buttons.
    if ((e.target as HTMLElement).getAttribute('role') !== 'button') return;
    const k = e.key.toLowerCase();
    if (k === 'a' && row.decidable) { e.preventDefault(); onAccept(row.id); }
    else if (k === 'r' && row.decidable) { e.preventDefault(); onReject(row.id); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const li = e.currentTarget.closest('li');
      const next = (e.key === 'ArrowDown' ? li?.nextElementSibling : li?.previousElementSibling) as HTMLElement | null;
      next?.querySelector<HTMLElement>('[data-testid="rail-row"][role="button"]')?.focus();
    }
  };
  return (
    <div onKeyDown={onKey} className="h-full">
      <RailRowView
        row={row}
        onOpen={onOpen}
        onAccept={row.decidable ? onAccept : undefined}
        onReject={row.decidable ? onReject : undefined}
      />
    </div>
  );
});

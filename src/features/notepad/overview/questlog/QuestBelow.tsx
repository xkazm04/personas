import { useCallback, useEffect, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DESK_KEY, Keycap } from '../parts/Keycap';

export interface BelowEntry {
  id: string;
  name: string;
  count: number;
  waiting: boolean;
  /** The zone straddles the fold rather than sitting entirely under it. */
  partial: boolean;
}

/**
 * What is under this column's fold, named.
 *
 * The fit ladder can run out, and when it does a column scrolls. A scrollbar
 * says "there is more" and nothing else; this strip says WHICH projects, how
 * many goals each holds, and whether any of them is waiting on the operator.
 * That is the difference between a design that collapses honestly and one that
 * hides work — and it is the rule the card desk breaks sixteen times over by
 * fading the tail of every group.
 */
export function QuestBelow({ column }: { column: HTMLElement | null }) {
  const { t, tx } = useTranslation();
  const [entries, setEntries] = useState<BelowEntry[]>([]);

  const recompute = useCallback(() => {
    if (!column) { setEntries([]); return; }
    const strip = column.querySelector<HTMLElement>('[data-below]');
    const fold = column.scrollTop + column.clientHeight - (strip?.offsetHeight ?? 0) - 4;
    const next: BelowEntry[] = [];
    for (const zone of column.querySelectorAll<HTMLElement>('[data-zone-id]')) {
      if (zone.offsetTop + zone.offsetHeight <= fold) continue;
      next.push({
        id: zone.dataset.zoneId ?? '',
        name: zone.dataset.zoneName ?? '',
        count: Number(zone.dataset.zoneCount ?? 0),
        waiting: zone.dataset.zoneWaiting === '1',
        partial: zone.offsetTop <= fold,
      });
    }
    setEntries(next);
  }, [column]);

  useEffect(() => {
    if (!column) return;
    recompute();
    column.addEventListener('scroll', recompute, { passive: true });
    return () => column.removeEventListener('scroll', recompute);
  }, [column, recompute]);

  if (entries.length === 0) return null;

  return (
    <div className="ql-below" data-below role="status">
      <span>{t.notepad.desk_below}</span>
      {entries.map((entry, i) => (
        <span key={entry.id} className={entry.waiting ? 'is-waiting' : undefined}>
          {i > 0 && <i className="ql-sep" aria-hidden>·</i>}
          <b>{entry.name}</b>
          {' '}
          {entry.partial
            ? tx(t.notepad.desk_below_continues, { count: entry.count })
            : entry.count}
          {entry.waiting ? ` · ${t.notepad.desk_needs_you}` : ''}
        </span>
      ))}
      <span className="ml-auto"><Keycap>{DESK_KEY.down}</Keycap></span>
    </div>
  );
}

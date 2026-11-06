import { memo, useEffect } from 'react';

import { GhostRows } from '@/features/shared/components/kit';
import { useProgressiveReveal, useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useTranslation } from '@/i18n/useTranslation';
import { pos } from '../model/timeAxis';
import type { GroupId, RowView, StandupView } from '../model/types';
import { StandupRow } from './StandupRow';

interface Props {
  view: StandupView;
  sel: number;
  typingKey: string | null;
  proposing: boolean;
  loading: boolean;
  onSelect: (index: number) => void;
  onPick: (row: RowView, index: number) => void;
  onTyped: (row: RowView, text: string | null) => void;
}

/** The group head is the table's chrome: name + count, then what each column means for this group. */
function GroupHead({ id, n }: { id: GroupId; n: number }) {
  const { t } = useTranslation();
  const g = t.athena.standup.groups[id];
  return (
    <div className="su-grp su-grid" role="presentation">
      <div><span className="typo-eyebrow text-foreground">{g.title}</span> <span className="typo-caption">{n}</span></div>
      <div><span className="typo-eyebrow">{g.past}</span></div>
      <div><span className="typo-eyebrow">{g.now}</span></div>
      <div><span className="typo-eyebrow">{g.night}</span></div>
    </div>
  );
}

/**
 * The Timetable body: one listbox of every row, grouped, the selected row
 * expanded. Rows enter once per standup (RevealItem, id-guarded), so a live
 * update or a decision never replays the cascade.
 */
export const StandupTable = memo(function StandupTable({ view, sel, typingKey, proposing, loading, onSelect, onPick, onTyped }: Props) {
  const { t } = useTranslation();
  const reveal = useProgressiveReveal(view.rows.length, { resetKey: view.id ?? 'none' });
  const enter = useRevealTracker(view.id ?? 'none', 'athena-standup');
  const selected = view.rows[sel];
  const nowPos = view.status === 'armed' ? pos(view.nowMs, view.night) : null;
  const editable = view.life === 'decide';

  const selectedKey = selected?.key;
  useEffect(() => {
    if (selectedKey) document.getElementById(`su-row-${selectedKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  if (loading && view.rows.length === 0) {
    return <div className="su-rows px-3"><GhostRows count={7} size="l" label={t.athena.standup.loading} /></div>;
  }
  let flat = 0;
  return (
    <div
      className="su-rows"
      role="listbox"
      tabIndex={0}
      aria-label={t.athena.standup.table_label}
      aria-activedescendant={selected ? `su-row-${selected.key}` : undefined}
      data-testid="standup-table"
    >
      {view.groups.map((g) => (
        <div key={g.id} role="group" aria-label={t.athena.standup.groups[g.id].title}>
          <GroupHead id={g.id} n={g.rows.length} />
          {g.rows.map((row) => {
            const index = flat++;
            if (index >= reveal.count) return null;
            return (
              <StandupRow
                key={row.key}
                row={row}
                index={index}
                revealOrder={index - reveal.newSince}
                selected={index === sel}
                editable={editable}
                typing={typingKey === row.key}
                proposing={proposing}
                nowPos={nowPos}
                hasEntered={enter.hasEntered}
                markEntered={enter.markEntered}
                onSelect={onSelect}
                onPick={onPick}
                onTyped={onTyped}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
});

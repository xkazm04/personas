import { memo, useEffect, type ReactNode } from 'react';

import { GhostRows, Section, Surface } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { StandupView } from '../../model/types';
import { FOCUS_COPY as F } from './copy';
import { QueueItem } from './QueueItem';

interface Props {
  view: StandupView;
  sel: number;
  proposing: boolean;
  loading: boolean;
  onSelect: (index: number) => void;
  /** Rendered above the groups, inside the same scroll (the return's report). */
  before?: ReactNode;
}

/**
 * The queue: one listbox of every line, grouped under sentence-case kit
 * section heads with their counts, hanging from one spine. The selected line
 * lights its segment of the spine; j/k (the controller) and a click move it,
 * and it is always scrolled into view.
 */
export const QueueRail = memo(function QueueRail({ view, sel, proposing, loading, onSelect, before }: Props) {
  const { t } = useTranslation();
  const selected = view.rows[sel];
  const selectedKey = selected?.key;
  useEffect(() => {
    if (selectedKey) document.getElementById(`sf-row-${selectedKey}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  if (loading && view.rows.length === 0) {
    return <div className="sf-rail__scroll"><GhostRows count={6} size="l" label={t.athena.standup.loading} /></div>;
  }
  let flat = 0;
  return (
    <div className="sf-rail__scroll">
      <Surface fluid>
        {before}
        <div
          className="sf-rail__list"
          role="listbox"
          tabIndex={0}
          aria-label={F.queue_label}
          aria-activedescendant={selected ? `sf-row-${selected.key}` : undefined}
          data-testid="standup-table"
        >
          {view.groups.map((g) => (
            <div key={g.id} role="group" aria-label={t.athena.standup.groups[g.id].title}>
              <Section level={2} title={t.athena.standup.groups[g.id].title} count={g.rows.length} className="sf-group">
                {g.rows.map((row) => {
                  const index = flat++;
                  return <QueueItem key={row.key} row={row} index={index} selected={index === sel} proposing={proposing} onSelect={onSelect} />;
                })}
              </Section>
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
});

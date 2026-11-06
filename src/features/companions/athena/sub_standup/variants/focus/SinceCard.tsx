import { memo } from 'react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { KeyValueGrid, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { SinceLast } from '../../model/types';
import { FOCUS_COPY as F } from './copy';

/**
 * The return: what moved since the last standup, as the first thing in the
 * rail, above the queue it explains. The pane keeps showing the selected
 * line, so reading the report never costs the operator their place.
 */
export const SinceCard = memo(function SinceCard({ since }: { since: SinceLast }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.since;
  const items = [
    { k: F.since_moved, v: tx(F.since_moved_v, { n: since.moved, p: since.projects }) },
    { k: F.since_parked, v: String(since.parked) },
    { k: F.since_running, v: String(since.running) },
    ...(since.created.length > 0 ? [{ k: F.since_created, v: since.created.join(', ') }] : []),
  ];
  return (
    <div className="sf-since">
      <Section
        level={2}
        title={s.label}
        meta={<span>{s.from} <AbsoluteTime timestamp={since.sinceMs} variant="time" /></span>}
      >
        <div className="sf-since__kv">
          <KeyValueGrid items={items} min="8rem" />
        </div>
      </Section>
    </div>
  );
});

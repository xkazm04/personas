import { memo } from 'react';

import { Dot } from '@/features/shared/components/kit';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { SinceLast } from '../model/types';

/**
 * "Since the last standup", from the plan's report: the return life's top
 * strip (the page half of the report; the orb nudge is the other half).
 */
export const SinceLastStrip = memo(function SinceLastStrip({ since }: { since: SinceLast }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.since;
  return (
    <section className="su-since" aria-label={s.label}>
      <span className="typo-eyebrow text-foreground">{s.label}</span>
      <span className="typo-caption">{s.from} <AbsoluteTime timestamp={since.sinceMs} variant="time" /></span>
      <span className="typo-body text-foreground"><Dot tone="success" /> {tx(s.moved, { n: since.moved, p: since.projects })}</span>
      <span className="typo-body text-foreground"><Dot tone="error" /> {tx(s.parked, { n: since.parked })}</span>
      {since.running > 0 && <span className="typo-body text-foreground"><Dot tone="success" glyph="live" /> {tx(s.running, { n: since.running })}</span>}
      {since.created.length > 0 && (
        <span className="typo-body text-foreground"><Dot tone="highlight" /> {tx(s.created, { names: since.created.join(', ') })}</span>
      )}
    </section>
  );
});

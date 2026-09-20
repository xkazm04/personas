// The reading-order card: one sentence saying how to read the altitude you
// are standing at, and, under council focus, what is lit and what is dimmed.
import type { RefObject } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import { useCouncilStore } from '../../councilStore';

/** The card's box is reserved by the label pass, so it needs a ref out. */
export function ReadingOrder({ cardRef }: { cardRef?: RefObject<HTMLDivElement | null> }) {
  const { t, tx } = useTranslation();
  const g = t.council.galaxy;
  const focus = useCouncilStore((s) => s.focus);
  const counts = useCouncilStore((s) => s.counts);
  const lensOn = useCouncilStore((s) => s.lensOn);

  if (focus.kind === 'council') {
    return (
      <div
        ref={cardRef}
        className="absolute left-4 top-4 z-10 max-w-[300px] rounded-card border border-card-border bg-card-bg px-4 py-3 shadow-elevation-2"
        data-testid="council-reading-order"
      >
        <div className="typo-heading uppercase tracking-[0.09em] text-muted-dark">
          {tx(g.council_focus_title, { title: focus.title })}
        </div>
        <p className="mt-1.5 typo-body text-foreground">
          {tx(g.council_focus_body, { lit: counts.lit, dimmed: counts.dimmed })}
        </p>
        <p className="mt-2 typo-caption text-muted-dark">{g.council_focus_escape}</p>
      </div>
    );
  }

  const level = counts.altitude;
  return (
    <div
      ref={cardRef}
      className="absolute left-4 top-4 z-10 max-w-[300px] rounded-card border border-card-border bg-card-bg px-4 py-3 shadow-elevation-2"
      data-testid="council-reading-order"
    >
      <div className="typo-heading uppercase tracking-[0.09em] text-muted-dark">
        {tx(g.reading_order, { level: g[`legend_${level}_title` as const] })}
      </div>
      <p className="mt-1.5 typo-body text-foreground">{g[`legend_${level}_body` as const]}</p>
      <p className="mt-2 typo-caption text-muted-dark">{lensOn ? g.legend_lens_on : g.legend_lens_off}</p>
      {counts.labelsHidden > 0 ? (
        <p className="mt-1 typo-caption text-muted-dark" data-testid="council-labels-hidden">
          <Numeric value={counts.labelsHidden} /> {g.foot_labels_hidden}
        </p>
      ) : null}
    </div>
  );
}

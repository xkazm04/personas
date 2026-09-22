// The rounds and the decision, with dates. Oldest first, as the board hands
// them over: a history that reorders itself is a history nobody can read twice.
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';

import type { TFeatures } from '../featuresModel';

export interface HistoryPanelProps {
  feature: BoardFeature;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function HistoryPanel({ feature, t, tx }: HistoryPanelProps) {
  const council = feature.council;
  return (
    <section className="rounded-card border border-border p-4" data-testid="features-history">
      <h3 className="typo-body-lg text-foreground">{t.history_title}</h3>
      {feature.history.length === 0 ? (
        <p className="mt-1 typo-caption">{t.history_none}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {feature.history.map((round) => (
            <li key={round.roundNo} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="typo-body text-foreground">{tx(t.history_round, { round: round.roundNo })}</span>
              <span className="typo-data text-foreground">
                {round.overall == null ? t.no_overall : <Numeric value={round.overall} precision={2} />}
              </span>
              {round.finishedAt ? (
                <RelativeTime timestamp={round.finishedAt} className="typo-caption" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {council?.decidedAt ? (
        <p className="mt-2 flex items-baseline gap-2 typo-caption">
          <span className="text-foreground">{t.history_decided}</span>
          <RelativeTime timestamp={council.decidedAt} />
        </p>
      ) : null}
      {council?.rejectionReason ? (
        <p className="mt-2 typo-body text-status-error">
          {tx(t.history_rejected, { reason: council.rejectionReason })}
        </p>
      ) : null}
      {council?.drift === 'changed' ? (
        <p className="mt-2 typo-caption text-status-warning">{t.drifted_note}</p>
      ) : null}
    </section>
  );
}

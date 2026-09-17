// What MOVED since the previous reading. Each row is a verdict computed twice
// — once at the newest production value, once at the one before it — so the
// arrow is the same rule the rest of the app grades with. Off-track arrivals
// come first because that is what a brief is for.
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import type { Translations } from '@/i18n/generated/types';

import { useTranslation } from '@/i18n/useTranslation';
import type { KpiTrack } from '../kpiMath';
import { TRACK_COLOR } from '../kpiMeta';
import type { KpiProjectRollup } from '../kpiOverviewModel';
import type { TimeWindow } from '../kpiSample';
import { sparkValues, stateChanges } from './AttentionLedger.model';
import { LedgerSpark } from './AttentionLedgerSpark';

/** Label for a pace verdict. `unmeasured` borrows the band label — in both the
 *  system has nothing to say. */
export function trackLabel(track: KpiTrack, t: Translations): string {
  switch (track) {
    case 'met':
      return t.kpis.stat_met;
    case 'on-track':
      return t.kpis.stat_on_track;
    case 'off-track':
      return t.kpis.stat_off_track;
    case 'unpaced':
      return t.kpis.stat_unpaced;
    default:
      return t.kpis.overview.band_labels.unmeasured;
  }
}

export function LedgerChanges({
  project,
  trends,
  window,
  sparkGhost,
  onOpen,
}: {
  project: KpiProjectRollup;
  trends: Record<string, DevKpiMeasurement[]>;
  window: TimeWindow | null;
  sparkGhost: boolean;
  onOpen: (kpiId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const changes = stateChanges(project, trends);

  return (
    <section className="space-y-1.5">
      {/* muted-ok: structural block label, not body copy */}
      <h4 className="typo-label text-muted-foreground">{o.changes_title}</h4>
      {changes.length === 0 ? (
        <p className="typo-caption text-foreground">{o.changes_none}</p>
      ) : (
        <ul className="space-y-1">
          {changes.map((c) => (
            <li key={c.kpi.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="typo-caption text-foreground text-left hover:text-primary focus-ring rounded-interactive truncate max-w-full"
                  aria-label={c.kpi.name}
                  onClick={() => onOpen(c.kpi.id)}
                >
                  {c.kpi.name}
                </button>
                {/* muted-ok: structural micro-label — the verdict transition carries its own status hue, the date locates it */}
                <p className="typo-caption text-muted-foreground">
                  <span style={{ color: TRACK_COLOR[c.to] }}>
                    {tx(o.changes_from_to, { from: trackLabel(c.from, t), to: trackLabel(c.to, t) })}
                  </span>
                  {' · '}
                  {new Date(c.at).toLocaleDateString()}
                </p>
              </div>
              <LedgerSpark
                values={sparkValues(c.kpi, trends[c.kpi.id], window)}
                color={TRACK_COLOR[c.to]}
                ghost={sparkGhost}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

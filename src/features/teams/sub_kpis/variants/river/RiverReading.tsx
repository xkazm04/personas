// The week under the cursor, stated in words with its denominator.
//
// A dry week gets a sentence of its own rather than an empty panel: "nothing
// was read anywhere in this scope" is a finding, and a blank box is not.
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';

import type { BedPoint, Riverbed } from './riverbed';

const WEEK_MS = 7 * 86_400_000;

export function RiverReading({ bed, point }: { bed: Riverbed; point: BedPoint | null }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  if (!point) {
    return (
      <section className="min-h-[10rem] rounded-card border border-card-border bg-secondary/10 p-3">
        <h3 className="typo-heading text-foreground">{o.river_reading_title}</h3>
        <p className="typo-caption text-foreground">{o.river_reading_hint}</p>
      </section>
    );
  }

  const pct = bed.declared === 0 ? 0 : (point.read / bed.declared) * 100;

  return (
    <section className="min-h-[10rem] space-y-2 rounded-card border border-card-border bg-secondary/10 p-3">
      <div>
        <h3 className="typo-heading text-foreground">{o.river_reading_title}</h3>
        <p className="typo-title text-foreground">
          <AbsoluteTime timestamp={point.week} variant="date" />
          {' – '}
          <AbsoluteTime timestamp={point.week + WEEK_MS - 1} variant="date" />
          {point.partial && <span className="typo-caption text-foreground">{` · ${o.river_partial}`}</span>}
        </p>
      </div>

      {point.read === 0 ? (
        <p className="typo-body text-foreground">{tx(o.river_dry_week, { declared: bed.declared })}</p>
      ) : (
        <>
          <p className="typo-body text-foreground">
            {tx(o.river_week_read, { read: point.read, declared: bed.declared, pct: pct.toFixed(1) })}
          </p>
          <dl className="space-y-0.5">
            <Line label={o.band_labels.met} value={point.met} total={point.read} tone="var(--status-success)" />
            <Line label={o.count_on_track} value={point.onTrack} total={point.read} tone="var(--primary)" />
            <Line label={o.count_off_track} value={point.offTrack} total={point.read} tone="var(--status-error)" />
            <Line label={o.river_silt} value={point.silt} total={point.read} tone="var(--muted-foreground)" />
          </dl>
        </>
      )}
    </section>
  );
}

/** One line of the week's reading. `value` is nullable because a week with no
 *  reading has no count to give, and printing 0 would claim it was measured
 *  and came back empty (golden path: metric-tile.md). */
function Line({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number | null;
  total: number;
  tone: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex items-center gap-1.5 typo-caption text-foreground">
        <span aria-hidden="true" className="block size-2.5 rounded-[2px]" style={{ background: tone }} />
        {label}
      </dt>
      <dd className="typo-data text-foreground tabular-nums">
        {value == null ? t.kpis.overview.read_never : `${value} / ${total}`}
      </dd>
    </div>
  );
}

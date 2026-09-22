// The map's key.
//
// It states the encoding in words because the encoding is the whole argument:
// area is the claim, light is the observation, and the hatch is 900 KPIs
// nobody has read. It also prints the two marks as QUANTITIES - "4 stale,
// 31 promised and never read" - so a reader knows whether to look for them.
//
// The LENS SWITCH lives beside the canvas rather than here: a control that
// swaps a region and the region it swaps have to declare each other, and they
// can only do that where both are rendered (golden path: tab-strip.md).
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../../kpiChartTheme';
import type { KpiTally } from '../../estate/kpiEstate';
import { TRACK_COLOR, type MapLens } from './mapPlot';

export function MapLegend({
  lens,
  tally,
  brokenPromises,
  dropped,
  floored,
}: {
  lens: MapLens;
  tally: KpiTally;
  brokenPromises: number;
  dropped: number;
  floored: number;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {lens === 'state' ? (
          <>
            <Key swatch={{ background: TRACK_COLOR.met }} label={o.band_labels.met} />
            <Key swatch={{ background: TRACK_COLOR['on-track'] }} label={o.count_on_track} />
            <Key swatch={{ background: TRACK_COLOR['off-track'] }} label={o.count_off_track} />
            <Key swatch={{ background: TRACK_COLOR.unpaced }} label={o.count_no_verdict} />
          </>
        ) : (
          <>
            <Key swatch={{ background: 'var(--status-success)' }} label={o.map_fresh} />
            <Key swatch={{ background: 'var(--status-warning)' }} label={o.map_aging} />
            <Key swatch={{ background: 'var(--status-error)' }} label={o.map_overdue} />
          </>
        )}
        <Key
          swatch={{ backgroundImage: HATCH_BG, backgroundSize: '4px 4px' }}
          label={tx(o.map_key_dark, { count: tally.unmeasured })}
        />
        <Key
          swatch={{ border: '1px dashed var(--status-info)' }}
          label={tx(o.map_key_stale, { count: tally.stale })}
        />
        <Key
          swatch={{
            backgroundImage:
              'radial-gradient(circle at center, var(--muted-foreground) 0 1.5px, transparent 1.5px)',
          }}
          label={tx(o.map_key_promised, { count: brokenPromises })}
        />
      </ul>

      <p className="typo-caption text-foreground">
        {dropped > 0 ? tx(o.map_dropped, { count: dropped }) : tx(o.map_all_drawn, { count: tally.total })}
        {floored > 0 && ` ${tx(o.map_floored, { count: floored })}`}
      </p>
    </div>
  );
}

function Key({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className="block size-3 shrink-0 rounded-[2px]" style={swatch} />
      <span className="typo-caption text-foreground">{label}</span>
    </li>
  );
}

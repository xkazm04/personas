// How to read the river - including the one thing the geometry does not say
// for itself.
//
// The water's width is a SQUARE ROOT of the share read, so a nine-KPI creek
// stays visible beside a 721-KPI river. That makes the widths comparable and
// NOT readable as quantities, which is a trade the surface has to declare
// rather than let a reader discover by measuring with a ruler.
import { useTranslation } from '@/i18n/useTranslation';

import type { Riverbed } from './riverbed';

export function RiverLegend({ bed, weeks }: { bed: Riverbed; weeks: number }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Key swatch={{ background: 'var(--status-success)' }} label={o.band_labels.met} />
        <Key swatch={{ background: 'var(--primary)' }} label={o.count_on_track} />
        <Key swatch={{ background: 'var(--status-error)' }} label={o.count_off_track} />
        <Key
          swatch={{ border: '1px dashed var(--muted-foreground)', background: 'transparent' }}
          label={o.river_silt}
        />
        <Key
          swatch={{
            backgroundImage:
              'repeating-linear-gradient(45deg, color-mix(in srgb, var(--muted-foreground) 28%, transparent) 0 3px, transparent 3px 6px)',
          }}
          label={tx(o.river_key_bed, { declared: bed.declared })}
        />
      </ul>
      <p className="typo-caption text-foreground">
        {tx(o.river_caption, { weeks, dry: bed.dryWeeks })}
      </p>
      <p className="typo-caption text-foreground">{o.river_scale_note}</p>
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

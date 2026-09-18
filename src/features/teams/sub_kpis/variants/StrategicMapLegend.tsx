// Legend + highlight chips for the Strategic map (WP1). The legend IS the
// filter: each chip names a band, shows its swatch exactly as the map draws it
// (hatch for `unmeasured` — never a fill), and carries the count of cells in
// that band, so the key doubles as a census. Clicking one dims everything else;
// a polite live line states what is highlighted, out of how many.
import type { KpiBand } from '../kpiOverviewModel';
import { BAND_COLOR, BAND_ORDER } from '../kpiOverviewModel';
import { bandFill, HATCH_BG } from '../kpiChartTheme';
import { useTranslation } from '@/i18n/useTranslation';
import type { BandCensus } from './StrategicMap.model';

export function StrategicMapLegend({
  census,
  active,
  onToggle,
}: {
  census: BandCensus;
  active: KpiBand | null;
  onToggle: (band: KpiBand | null) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const status =
    active === null
      ? tx(o.highlight_none, { total: census.total })
      : tx(o.highlight_status, {
          label: o.band_labels[active],
          count: census.counts[active],
          total: census.total,
        });

  return (
    <div className="space-y-1.5">
      {/* muted-ok: the legend's encoding caption is chrome that explains the map, not content to read */}
      <p className="typo-caption text-muted-foreground">{o.coverage_caption}</p>
      <div className="flex flex-wrap items-center gap-1.5" aria-label={o.legend_title}>
        <Chip active={active === null} onClick={() => onToggle(null)}>
          {o.highlight_all}
        </Chip>
        {BAND_ORDER.map((band) => {
          const count = census.counts[band];
          const isActive = active === band;
          return (
            <Chip
              key={band}
              active={isActive}
              disabled={count === 0 && !isActive}
              onClick={() => onToggle(isActive ? null : band)}
            >
              <span
                aria-hidden="true"
                className="inline-block w-3 h-3 rounded-interactive border border-primary/20"
                style={
                  band === 'unmeasured'
                    ? { backgroundImage: HATCH_BG }
                    : { background: bandFill(BAND_COLOR[band], 1) }
                }
              />
              <span>{o.band_labels[band]}</span>
              {/* muted-ok: a band count inside its own chip — the label carries the meaning */}
              <span className="typo-data text-muted-foreground">{count}</span>
            </Chip>
          );
        })}
      </div>
      {/* muted-ok: the polite highlight status restates the chips; screen readers get it verbatim */}
      <p className="typo-caption text-muted-foreground" aria-live="polite" data-testid="kpi-map-highlight-status">
        {status}
      </p>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 typo-caption rounded-interactive border px-2 py-1 transition-colors focus-ring disabled:is-disabled ${
        active
          ? 'border-primary/50 bg-primary/15 text-foreground'
          : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/40'
      }`}
    >
      {children}
    </button>
  );
}

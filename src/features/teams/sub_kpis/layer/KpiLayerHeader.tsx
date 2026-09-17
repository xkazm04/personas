// Breadcrumb row of the Project › Group layer: where you are, how to get out,
// and — beside the band pill — the denominator the band was computed over, so
// a green pill with 2 of 40 measured can never read as 40 of 40.
import { ArrowLeft } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { BAND_COLOR, type KpiBand } from '../kpiOverviewModel';
import { bandFill, HATCH_BG } from '../kpiChartTheme';

export function KpiLayerHeader({
  projectLabel,
  groupLabel,
  measured,
  total,
  band,
  onBack,
}: {
  projectLabel: string;
  /** null = the whole project (printed as `layer_project_all`). */
  groupLabel: string | null;
  measured: number;
  total: number;
  band: KpiBand;
  onBack: () => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const unmeasured = band === 'unmeasured';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        data-testid="kpi-layer-back"
        onClick={onBack}
        aria-label={o.layer_back}
        className="inline-flex items-center gap-1.5 rounded-interactive px-2 py-1 typo-label text-foreground hover:bg-secondary/40 focus-ring"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
        {o.layer_back}
      </button>

      <p className="typo-body font-medium text-foreground flex items-center gap-1.5 min-w-0">
        <span className="truncate">{projectLabel}</span>
        {/* muted-ok: breadcrumb separator glyph — chrome between two labels */}
        <span className="text-muted-foreground" aria-hidden>
          ›
        </span>
        <span className="truncate">{groupLabel ?? o.layer_project_all}</span>
      </p>

      <span className="ml-auto flex items-center gap-2">
        <span className="typo-caption" data-testid="kpi-layer-coverage">
          {tx(o.measured_of, { measured, total })}
        </span>
        <span
          className="rounded-pill px-2 py-0.5 typo-label text-foreground"
          data-testid="kpi-layer-band"
          style={{
            background: unmeasured ? undefined : bandFill(BAND_COLOR[band], 1),
            backgroundImage: unmeasured ? HATCH_BG : undefined,
          }}
        >
          {o.band_labels[band]}
        </span>
      </span>
    </div>
  );
}

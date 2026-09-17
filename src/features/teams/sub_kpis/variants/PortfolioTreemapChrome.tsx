// Chrome around the treemap canvas: the zoom breadcrumb, the band legend, and
// the ghost. Split out so PortfolioTreemap.tsx stays the orchestrator (repo
// law: 200 LOC per file under src/features/**).
import { ChevronLeft } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { BAND_COLOR, BAND_ORDER } from '../kpiOverviewModel';
import { bandFill, HATCH_BG } from '../kpiChartTheme';
import { TREEMAP_HEIGHT } from './PortfolioTreemapSize';

export function TreemapBreadcrumb({
  projectLabel,
  onZoomOut,
  onOpenProject,
}: {
  projectLabel: string;
  onZoomOut: () => void;
  onOpenProject: () => void;
}) {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="kpi-treemap-breadcrumb">
      <button
        type="button"
        onClick={onZoomOut}
        aria-label={o.treemap_zoom_out}
        className="typo-caption focus-ring rounded-interactive border border-primary/15 bg-secondary/20 px-2 py-1 text-foreground hover:bg-secondary/40 inline-flex items-center gap-1"
      >
        <ChevronLeft className="w-3 h-3" aria-hidden />
        {o.treemap_zoom_out}
      </button>
      {/* muted-ok: breadcrumb separator glyph, pure chrome */}
      <span className="typo-caption text-muted-foreground" aria-hidden>›</span>
      <span className="typo-label text-foreground truncate max-w-[16rem]">{projectLabel}</span>
      <button
        type="button"
        onClick={onOpenProject}
        aria-label={o.layer_project_all}
        className="typo-caption focus-ring rounded-interactive border border-primary/15 bg-secondary/20 px-2 py-1 text-foreground hover:bg-secondary/40"
      >
        {o.layer_project_all}
      </button>
    </div>
  );
}

export function TreemapLegend() {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  return (
    <div className="flex items-center gap-3 flex-wrap" aria-label={o.legend_title}>
      {BAND_ORDER.map((band) => (
        // muted-ok: legend micro-label beside its swatch
        <span key={band} className="inline-flex items-center gap-1.5 typo-caption text-muted-foreground">
          <span
            className="inline-block w-3 h-3 rounded-[3px] border border-primary/15"
            style={
              band === 'unmeasured'
                ? { backgroundImage: HATCH_BG }
                : { background: bandFill(BAND_COLOR[band], 1) }
            }
            aria-hidden
          />
          {o.band_labels[band]}
        </span>
      ))}
    </div>
  );
}

export function TreemapGhost() {
  return (
    <div
      data-testid="kpi-treemap-ghost"
      aria-hidden="true"
      className="rounded-card bg-primary/[0.06] animate-fade-in"
      style={{ height: TREEMAP_HEIGHT, animationDelay: '150ms' }}
    />
  );
}

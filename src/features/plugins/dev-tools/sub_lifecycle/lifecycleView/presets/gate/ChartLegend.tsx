/**
 * How to read the run charts, said once under the rows: each swatch is drawn
 * exactly as its mark is drawn in a chart (`RunChart`), so the legend cannot
 * drift from the drawing, followed by what the times measure.
 */
import type { CSSProperties } from 'react';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { HATCH } from './RunChart';

function Swatch({ className, style, label }: { className: string; style?: CSSProperties; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`block ${className}`} style={style} />
      <span className={LT.meta}>{label}</span>
    </span>
  );
}

export function ChartLegend() {
  const { dl } = useLifecycleViewModel();
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid="lc6-chart-legend">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5" role="group" aria-label={dl.lcx6_legend}>
        <Swatch className="h-3 w-2 rounded-t-interactive bg-status-success" label={dl.lcx6_legend_passed} />
        <Swatch className="h-3 w-2 rounded-t-interactive bg-status-warning" label={dl.lcx6_legend_over} />
        <Swatch className="h-3 w-2 rounded-t-interactive bg-status-error" label={dl.lcx6_legend_failed} />
        <Swatch className="h-1.5 w-2 rounded-t-interactive border border-status-warning" style={HATCH} label={dl.lcx6_legend_timeout} />
        <Swatch className="h-1.5 w-2 rounded-t-interactive border border-dashed border-foreground/60" label={dl.lcx6_legend_did_not_run} />
        <Swatch className="w-5 border-t-2 border-dashed border-foreground/70" label={dl.lcx6_legend_budget} />
        <Swatch className="h-3 w-5 border-t border-primary/40 bg-primary/10" label={dl.lcx6_legend_band} />
      </div>
      <p className={LT.meta}>{dl.lc2_speed_caption}</p>
    </div>
  );
}

// The Coverage lane — "Ledger" (won the 2026-08-26 A/B over Matrix / Gauges
// and the baseline tile grid). Carries Matrix's column header strip so each
// pipeline stage is named once at the top instead of only on hover.
//
// Strategy: a PIPELINE read left-to-right. Each project is one row whose four
// dimensions are drawn as connected stage pills — registry → extracted →
// applied → fresh — joined by a thin track, so "where does the project stall
// in the pipeline" reads as the first grey pill. Each pill carries its icon
// and state word; hovering shows the detail. Left of the pills a bold project
// name with the worst-tone dot; right of them the debt numeral and a chevron.
// The pipeline metaphor makes the four dimensions a SEQUENCE, which the grid
// and the ring both leave implicit.

import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TileView } from '../coverageModel';
import { TONE_BG, TONE_CHIP, readDimensions, worstTone } from './coverageDimensions';

export function CoverageLedger({ tiles, onOpen }: { tiles: TileView[]; onOpen: (v: TileView) => void }) {
  const { t, tx } = useTranslation();
  const tc = t.overview.registry_coverage;
  const headers = [tc.dim_registry, tc.dim_extracted, tc.dim_applied, tc.dim_freshness];
  return (
    <div className="flex flex-col gap-1.5">
      {/* Column titles over the pipeline — same widths as the row below:
          w-48 name gutter, four equal stage tracks, then the debts/chevron
          block. Named once here so the pills can stay short. */}
      <div className="flex items-center gap-4 px-3.5 py-1.5" role="row">
        <span className="w-48 shrink-0" />
        <span className="flex flex-1 items-center">
          {headers.map((h) => (
            <span key={h} className="flex-1 typo-caption font-mono uppercase tracking-widest text-foreground">{h}</span>
          ))}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="typo-caption font-mono uppercase tracking-widest text-foreground">{tc.drawer_debts}</span>
          <span className="w-4" />
        </span>
      </div>
      {tiles.map((view) => {
        const dims = readDimensions(view, t, tx);
        const worst = worstTone(dims);
        const debts = view.tile.debts.length;
        return (
          <button key={view.tile.projectId} type="button" onClick={() => onOpen(view)}
            aria-label={tx(tc.tile_open_aria, { name: view.tile.projectName })}
            className="group flex w-full items-center gap-4 rounded-card border border-primary/10 bg-secondary/15 px-3.5 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-secondary/30 focus-ring">
            <span className="flex w-48 shrink-0 items-center gap-2.5 min-w-0">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_BG[worst]}`} aria-hidden="true" />
              <span className="typo-body font-semibold text-foreground truncate">{view.tile.projectName}</span>
            </span>

            {/* The pipeline */}
            <span className="flex flex-1 items-center min-w-0">
              {dims.map((d, i) => (
                <span key={d.key} className="flex items-center min-w-0 flex-1">
                  <span title={`${d.label}: ${d.detail}`}
                    className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 typo-caption font-medium min-w-0 ${TONE_CHIP[d.tone]}`}>
                    <d.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{d.state}</span>
                  </span>
                  {i < dims.length - 1 && (
                    <span className={`h-px flex-1 min-w-3 ${d.tone === 'muted' || d.tone === 'error' ? 'bg-primary/15' : 'bg-status-success/40'}`} aria-hidden="true" />
                  )}
                </span>
              ))}
            </span>

            <span className="flex shrink-0 items-center gap-3">
              {view.inSync ? (
                <span className="typo-caption font-medium text-status-success">{tc.in_sync}</span>
              ) : (
                <span className={`typo-data tabular-nums ${debts > 0 ? 'text-status-error' : 'text-foreground/40'}`}>{debts}</span>
              )}
              <ChevronRight className="h-4 w-4 text-foreground/40 transition-colors group-hover:text-primary" aria-hidden="true" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Prototype variant A — "Matrix"
//
// Strategy: projects × dimensions as a HEAT GRID. One row per project, one
// column per dimension, each cell a solid tone block carrying its state word.
// Colour does the separating: a row that is all green is healthy at a glance,
// a red cell jumps out, muted cells read as "nothing known" rather than
// "bad". The project name is the only prose; a debt count sits at the row's
// end as a numeral. The best direction for comparing projects against each
// other — you scan a column to see who is behind on one dimension.

import { useTranslation } from '@/i18n/useTranslation';
import type { TileView } from '../coverageModel';
import { DIM_KEYS, TONE_BG, readDimensions, worstTone, type DimTone } from './coverageDimensions';

const CELL: Record<DimTone, string> = {
  success: 'bg-status-success/20 text-status-success border-status-success/30',
  info: 'bg-status-info/20 text-status-info border-status-info/30',
  warning: 'bg-status-warning/20 text-status-warning border-status-warning/30',
  error: 'bg-status-error/20 text-status-error border-status-error/30',
  muted: 'bg-secondary/40 text-foreground/50 border-border/40',
};

const GRID = 'minmax(180px, 1.4fr) repeat(4, minmax(120px, 1fr)) 64px';

export function CoverageMatrix({ tiles, onOpen }: { tiles: TileView[]; onOpen: (v: TileView) => void }) {
  const { t, tx } = useTranslation();
  const tc = t.overview.registry_coverage;
  const headers = [tc.dim_registry, tc.dim_extracted, tc.dim_applied, tc.dim_freshness];

  return (
    <div className="rounded-card border border-primary/15 bg-secondary/10 overflow-hidden">
      <div className="grid items-center gap-2 border-b border-primary/10 bg-primary/5 px-3 py-2" style={{ gridTemplateColumns: GRID }} role="row">
        <span />
        {headers.map((h) => (
          <span key={h} className="typo-caption font-mono uppercase tracking-widest text-foreground text-center">{h}</span>
        ))}
        <span className="typo-caption font-mono uppercase tracking-widest text-foreground text-right">{tc.drawer_debts}</span>
      </div>
      <div className="divide-y divide-primary/[0.06]">
        {tiles.map((view) => {
          const dims = readDimensions(view, t, tx);
          const worst = worstTone(dims);
          return (
            <button key={view.tile.projectId} type="button" onClick={() => onOpen(view)}
              aria-label={tx(tc.tile_open_aria, { name: view.tile.projectName })}
              style={{ gridTemplateColumns: GRID }}
              className="grid w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/30 focus-ring">
              <span className="flex items-center gap-2.5 min-w-0">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_BG[worst]}`} aria-hidden="true" />
                <span className="typo-body font-medium text-foreground truncate">{view.tile.projectName}</span>
                {view.inSync && <span className="typo-caption text-status-success shrink-0">{tc.in_sync}</span>}
              </span>
              {DIM_KEYS.map((k) => {
                const d = dims.find((x) => x.key === k)!;
                return (
                  <span key={k} title={d.detail}
                    className={`flex items-center justify-center rounded-interactive border px-2 py-1.5 typo-caption font-medium truncate ${CELL[d.tone]}`}>
                    {d.state}
                  </span>
                );
              })}
              <span className={`text-right typo-data tabular-nums ${view.tile.debts.length > 0 ? 'text-status-error' : 'text-foreground/40'}`}>
                {view.tile.debts.length}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

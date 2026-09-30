import type { ReactNode } from 'react';
import { Ghost } from './states';
import { cx, kitAttrs, stateClass, type KitState } from './types';

export interface StatTile {
  label: ReactNode;
  /** null renders an honest "-". */
  value: ReactNode | null;
  unit?: ReactNode;
  /** A UnitStrip under the figure: the quantity drawn, not only stated. */
  draw?: ReactNode;
  note?: ReactNode;
  state?: KitState;
}

/**
 * StatStrip: a lone stat tile is a strip of one. The label glows (`typo-card-label`), the figure
 * is `typo-data-lg` at 500, the draw sits under the figure, and the strip wraps.
 * @catalog StatStrip - stat tiles (glowing label, figure, drawn quantity); a lone tile is a strip of one. Kit.
 */
export function StatStrip({ tiles, state }: { tiles: readonly StatTile[]; state?: KitState }) {
  return (
    <div className={cx('k-stats', stateClass(state))} {...kitAttrs('StatStrip', state)}>
      {tiles.map((t, i) => {
        const tst = state === 'loading' ? 'loading' : t.state ?? 'default';
        const loading = tst === 'loading';
        return (
          <div key={i} className={cx('k-tile', stateClass(tst))}>
            <span className="typo-card-label">{t.label}</span>
            <span className="k-tile__fig">
              {loading ? <Ghost width="64px" height="22px" /> : (
                <>
                  <span className="typo-data-lg k-medium">{t.value == null ? <span className="k-quiet">-</span> : t.value}</span>
                  {t.unit && <span className="typo-caption">{t.unit}</span>}
                </>
              )}
            </span>
            {(loading || t.draw) && <span className="k-tile__draw">{loading ? <Ghost width="80%" /> : t.draw}</span>}
            {t.note && <span className="typo-caption">{t.note}</span>}
          </div>
        );
      })}
    </div>
  );
}

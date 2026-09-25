import type { ReactNode } from 'react';
import { Mark } from './Mark';
import { emptyBand, GhostRows, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type Glyph, type KitStates, type Tone } from './types';

export type RowSize = 'line' | 's' | 'm' | 'l';

export interface ListRowProps {
  name: ReactNode;
  meta?: ReactNode;
  mark?: { tone: Tone; glyph?: Glyph; label: string };
  /** Figures, always regular weight; the caller says what they are. */
  figures?: ReactNode;
  time?: ReactNode;
  size?: RowSize;
  state?: KitStates;
  /** Overrides the one emphasised name recipe (`typo-body k-strong`). */
  nameClass?: string;
}

/**
 * ListRow: a fixed-height row on the 8px grid with ONE emphasised name, quiet meta and an
 * alternating band; its status mark sits on the spine and a selected row lights its segment.
 */
export function ListRow({ name, meta, mark, figures, time, size = 'm', state, nameClass }: ListRowProps) {
  const trail = figures != null || time != null;
  return (
    <div className={cx('k-row', `k-row--${size}`, stateClass(state))} {...kitAttrs('ListRow', state)}>
      {mark && <Mark tone={mark.tone} glyph={mark.glyph} label={mark.label} />}
      <div className="k-row__main">
        <div className={cx('k-row__name', nameClass ?? 'typo-body k-strong')}>{name}</div>
        {meta != null && <div className="k-row__meta typo-caption">{meta}</div>}
      </div>
      {trail && (
        <div className="k-row__trail">
          {figures}
          {time != null && <span className="k-time typo-data k-regular k-quiet">{time}</span>}
        </div>
      )}
    </div>
  );
}

/** A list of rows, or its loading ghost, or its empty band: the list's three states. */
export function Rows({ loading, empty, children, count }: {
  loading?: boolean;
  empty: EmptySpec;
  /** Number of rows about to render; 0 renders the empty band. */
  count: number;
  children: ReactNode;
}) {
  if (loading) return <GhostRows />;
  if (count === 0) return <>{emptyBand(empty)}</>;
  return <div className="k-rows">{children}</div>;
}

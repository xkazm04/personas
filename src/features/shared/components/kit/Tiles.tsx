import { useId, type CSSProperties, type ReactNode } from 'react';
import { emptyBand, GhostRows, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type KitStates } from './types';

/**
 * Tiles: the dashboard grid (grow-3). Twelve columns; a Tile spans `span` of them. Rows are
 * CONTENT-SIZED: the tiles of one row stretch to its tallest, so heads align at the top and
 * footers pin to the bottom, and nothing clips or scrolls inside a tile: the page scrolls. The
 * grid is its own size container, so spans collapse by the room it has, not the window: under
 * 1100px a span of 1-3 becomes 6 (never four tiles abreast), under 720px every tile is full
 * width. `cols={1}` stacks tiles at the kit gap for narrow hosts (a chat column, an evidence well).
 * @catalog Tiles - the dashboard grid: 12 columns, content-sized rows, spans collapse by the grid's own width; cols={1} stacks. Kit.
 */
export function Tiles({ label, cols = 12, children }: { label: string; cols?: 12 | 1; children: ReactNode }) {
  return (
    <div className={cx('k-dtiles', cols === 1 && 'k-dtiles--stack')} role="group" aria-label={label} {...kitAttrs('Tiles')}>
      {children}
    </div>
  );
}

export interface TileProps {
  /** Columns of 12 (ignored in a stacked grid). */
  span?: number;
  /** Present = the tile is a labelled region with a heading (h3, as a level-2 Section). */
  title?: ReactNode;
  /** Regular-weight figure after the title. */
  count?: ReactNode;
  meta?: ReactNode;
  /** Top-right of the head. */
  actions?: ReactNode;
  /** Actions for the tile's content (Approve, Re-run): inside the tile, pinned to its bottom edge. */
  footer?: ReactNode;
  state?: KitStates;
  /** Rendered in place of the body when the state is `empty`. */
  empty?: EmptySpec;
  /** Present = the tile failed to load: the band in the error tone, its action the retry. */
  error?: EmptySpec;
  /** Loading ghost rows (the tile's own geometry: a list tile ghosts its rows). */
  ghostRows?: number;
  testId?: string;
  children?: ReactNode;
}

/**
 * Tile: one dashboard part in a Tiles grid. Owns the chrome and the head recipe (ONE emphasis,
 * the title; count and meta regular; actions top-right), the body and the footer. No row span
 * and no inner scroll: the content decides the height. A long list inside is a capped `Rows`
 * (`cap`), which expands in place. The loading ghost follows `ghostRows`; empty and error are the
 * kit's empty band.
 * @catalog Tile - a dashboard tile in Tiles: head (title, count, meta, actions), body, footer actions; loading/empty/error states; content-sized. Kit.
 */
export function Tile({ span = 12, title, count, meta, actions, footer, state, empty, error, ghostRows = 3, testId, children }: TileProps) {
  const id = useId();
  const states = typeof state === 'string' ? [state] : state ?? [];
  const loading = states.includes('loading');
  const body = error
    ? emptyBand({ tone: 'error', ...error })
    : loading
      ? <GhostRows count={ghostRows} />
      : states.includes('empty')
        ? emptyBand(empty ?? { title: '' })
        : children;
  const n = Math.min(12, Math.max(1, Math.round(span)));
  const Root = title != null ? 'section' : 'div';
  return (
    <Root
      className={cx('k-dtile', stateClass(state), error && 'is-error')}
      {...kitAttrs('Tile', state)}
      aria-labelledby={title != null ? id : undefined}
      data-span={n}
      data-testid={testId}
      style={{ '--span': n } as CSSProperties}
    >
      {(title != null || actions) && (
        <header className="k-dtile__head">
          {title != null && (
            <div className="k-dtile__titles">
              <h3 id={id} className="k-dtile__title typo-title">
                <span className="k-node" aria-hidden="true" />
                {title}
                {count != null && <span className="k-count typo-data k-regular">{count}</span>}
              </h3>
              {meta && <div className="k-dtile__meta typo-caption">{meta}</div>}
            </div>
          )}
          {actions && !loading && <div className="k-dtile__actions">{actions}</div>}
        </header>
      )}
      <div className="k-dtile__body">{body}</div>
      {footer && !loading && !error && <footer className="k-dtile__foot">{footer}</footer>}
    </Root>
  );
}

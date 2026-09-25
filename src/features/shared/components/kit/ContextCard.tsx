import type { CSSProperties, ReactNode } from 'react';
import { Mark } from './Mark';
import { Ghost, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type Glyph, type KitStates, type Tone } from './types';

export interface ContextCardProps {
  title: ReactNode;
  meta?: ReactNode;
  /** Figures, regular weight (typo-data spans, a UnitStrip); they sit at the card's foot. */
  figures?: ReactNode;
  /** Actions (KitButtons); they stay pressable above the card's own press. */
  actions?: ReactNode;
  /** Status, drawn ON the card's rail at the title's height (the card's own spine). */
  mark?: { tone: Tone; glyph?: Glyph; label: string };
  state?: KitStates;
  /** Rendered in place of meta and figures when the state is `empty`. */
  empty?: EmptySpec;
  /** Present = the card selects: its title becomes a button whose hit area is the whole card. */
  onPress?: () => void;
  testId?: string;
}

/**
 * ContextCard: one thing among peers (a context, a project, a crew) when the peers read as
 * tiles, not as a list. It is a BAND, not a boxed surface: the kit's stepped band with a faint
 * primary wash from a 2px rail on its left edge, no border, the row's right-only radius. The
 * rail is the card's spine: its Mark sits on it, a selected card lights it in the primary glow,
 * a live card breathes. One emphasised name, quiet meta, regular figures at the foot. Loading
 * keeps the card's geometry with ghosts; empty is the kit's dashed band. A pressable card's
 * title is the one button (its hit area stretched over the card) so actions are never nested.
 * @catalog ContextCard - one peer as a tile: a band with a primary rail (mark on it, glow when selected), name, meta, figures, actions; ghost and empty states. ContextCards is the grid. Kit.
 */
export function ContextCard({ title, meta, figures, actions, mark, state, empty, onPress, testId }: ContextCardProps) {
  const states = typeof state === 'string' ? [state] : state ?? [];
  const loading = states.includes('loading');
  const isEmpty = !loading && states.includes('empty');
  const selected = states.includes('selected');
  return (
    <div className={cx('k-card', stateClass(state), onPress && 'is-pressable')} {...kitAttrs('ContextCard', state)} data-testid={testId}>
      {loading ? (
        <>
          <span className="k-mark" aria-hidden="true" />
          <Ghost width="58%" height="12px" />
          <Ghost width="40%" height="8px" />
          <span className="k-card__figs"><Ghost width="44px" inline /><Ghost width="72px" inline /></span>
        </>
      ) : (
        <>
          {isEmpty
            ? <Mark tone={empty?.tone ?? 'neutral'} glyph="hollow" label={empty?.markLabel ?? (typeof empty?.title === 'string' ? empty.title : '')} />
            : mark && <Mark tone={mark.tone} glyph={mark.glyph} label={mark.label} />}
          {onPress ? (
            <button type="button" className="k-card__title k-card__press typo-body k-strong" aria-pressed={selected} onClick={onPress}>{title}</button>
          ) : (
            <div className="k-card__title typo-body k-strong">{title}</div>
          )}
          {isEmpty ? (
            <div className="k-card__empty">
              {empty?.title && <span className="typo-caption">{empty.title}</span>}
              {empty?.hint && <span className="typo-caption">{empty.hint}</span>}
              {empty?.action}
            </div>
          ) : (
            <>
              {meta != null && <div className="k-card__meta typo-caption">{meta}</div>}
              {figures != null && <div className="k-card__figs">{figures}</div>}
            </>
          )}
          {actions && <div className="k-card__actions">{actions}</div>}
        </>
      )}
    </div>
  );
}

/** The grid ContextCards sit in: auto-fill columns from `min`, starting on the reading line.
 * @catalog ContextCards - the auto-fill grid of ContextCards on the reading line. Kit.
 */
export function ContextCards({ label, min, children }: { label: string; min?: string; children: ReactNode }) {
  const style = min ? ({ '--card-min': min } as CSSProperties) : undefined;
  return <div className="k-cards" role="group" aria-label={label} style={style}>{children}</div>;
}

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
  /**
   * Decoration in the head's top-right (an illustration, a module glyph): hidden from the tree,
   * never pressable (a press on it lands on the card), never on the foot. Beside actions it sits
   * to their left and the actions keep the corner. The caller colours it (`k-toned t-<tone>`).
   */
  art?: ReactNode;
  /** Status, drawn ON the card's rail at the title's height (the card's own spine). */
  mark?: { tone: Tone; glyph?: Glyph; label: string };
  /**
   * The card's own quantity painted as its BACKGROUND (grow-4): `value` is 0..1 of the card's
   * width, washed in `tone` over the band. The owner's call on 2026-10-03 - "bars can be
   * represented by card background fill, number of passed tours in right top corner. This way we
   * can get rid of third row" - so a card states its quantity without spending a row on a strip.
   * It is a background LAYER under the band's own gradient, so the band is tinted, never replaced,
   * and the rail (a pseudo-element over the background) is untouched. The figure that reads it
   * aloud belongs in `figure`; a fill alone is decoration and carries no accessible name.
   */
  fill?: { value: number; tone?: Tone };
  /**
   * A figure in the card's TOP-RIGHT corner ("4/4"): the quantity `fill` draws, stated. It keeps
   * the corner on its own and, like `art`, gives it up to `actions` when a card has them, so the
   * three never collide. Not drawn while loading.
   */
  figure?: ReactNode;
  state?: KitStates;
  /** Rendered in place of meta and figures when the state is `empty`. */
  empty?: EmptySpec;
  /** Present = the card selects: its title becomes a button whose hit area is the whole card. */
  onPress?: () => void;
  testId?: string;
  /**
   * A region between the head and the foot (grow-4; recorded as a gap at home-2) - a sentence, a
   * strip, a `Stack` of regions. The head stays at the top and the figures stay pinned to the
   * bottom edge around it, so grow-1's law still holds. Not drawn while loading or empty, where
   * those states own the card's geometry.
   */
  children?: ReactNode;
}

/**
 * ContextCard: one thing among peers (a context, a project, a crew) when the peers are FEW and
 * read as tiles, not as a list (many peers get a parent layer first: ContextOverview). It is a
 * BAND, not a boxed surface: the kit's stepped band with a faint primary wash from a 2px rail on
 * its left edge, no border, the row's right-only radius. The rail is the card's spine: its Mark
 * sits on it, a selected card lights it in the primary glow, a live card breathes.
 *
 * One layout whatever the card carries, so cards in a row align: the HEAD (title, then meta) at
 * the top with the actions at its top-right, and the FOOT (figures) pinned to the bottom edge.
 * Actions never take the foot, so a card with actions and one without keep their figure lines
 * on one line. Loading ghosts the same two places; empty puts its title in the meta line and
 * its hint and action in the foot. A pressable card's title is its one button (its hit area
 * stretched over the card) so the actions are never nested in it. Art (grow-2) is the head's
 * decoration: top-right, aria-hidden, pointer-events off, so it never displaces the foot.
 *
 * grow-4 collapses the card to what it actually carries: the head's meta line was already
 * conditional, the FOOT now is too, and the card's floor dropped from 104px to 80px - together
 * that is the "second row is empty always" the owner saw on the Learning tour cards. `fill` paints
 * the card's quantity as its background and `figure` states it in the top-right corner, which is
 * the third row those cards no longer need. `children` is the region between head and foot.
 * @catalog ContextCard - one of few peers as a tile: a band on a rail, head on top (figure/art top-right), an optional body, figures on the foot, and its quantity as a background fill; ContextCards grids them. Kit.
 */
export function ContextCard({ title, meta, figures, actions, art, mark, fill, figure, state, empty, onPress, testId, children }: ContextCardProps) {
  const states = typeof state === 'string' ? [state] : state ?? [];
  const loading = states.includes('loading');
  const isEmpty = !loading && states.includes('empty');
  const selected = states.includes('selected');
  const cardMark = loading
    ? <span className="k-mark" aria-hidden="true" />
    : isEmpty
      ? <Mark tone={empty?.tone ?? 'neutral'} glyph="hollow" label={empty?.markLabel ?? (typeof empty?.title === 'string' ? empty.title : '')} />
      : mark && <Mark tone={mark.tone} glyph={mark.glyph} label={mark.label} />;
  const name = loading
    ? <Ghost width="58%" height="12px" />
    : onPress
      ? <button type="button" className="k-card__title k-card__press typo-body k-medium" aria-pressed={selected} onClick={onPress}>{title}</button>
      : <div className="k-card__title typo-body k-medium">{title}</div>;
  const line = loading ? <Ghost width="40%" height="8px" /> : isEmpty ? empty?.title : meta;
  const foot = loading
    ? <><Ghost width="44px" inline /><Ghost width="72px" inline /></>
    : isEmpty
      ? <>{empty?.hint && <span className="typo-caption">{empty.hint}</span>}{empty?.action}</>
      : figures;
  // The foot renders only when it carries something. A card with no figures was still paying for
  // the foot's min-height and its margin-top:auto, which is the always-empty row the owner saw on
  // the Learning tour cards; with the strip moved into `fill` that row has nothing left to hold.
  const hasFoot = loading || (isEmpty ? empty?.hint != null || empty?.action != null : figures != null);
  const style = fill ? ({ '--fill': `${Math.round(Math.min(1, Math.max(0, fill.value)) * 100)}%` } as CSSProperties) : undefined;
  return (
    <div
      className={cx('k-card', stateClass(state), onPress && 'is-pressable', fill && 'k-card--fill', fill && `t-${fill.tone ?? 'primary'}`)}
      {...kitAttrs('ContextCard', state)}
      data-testid={testId}
      style={style}
    >
      {cardMark}
      <div className="k-card__head">
        <div className="k-card__titles">
          {name}
          {line != null && line !== '' && <div className="k-card__meta typo-caption">{line}</div>}
        </div>
        {figure != null && !loading && <div className="k-card__figure typo-data k-regular">{figure}</div>}
        {art && !loading && <div className="k-card__art" aria-hidden="true">{art}</div>}
        {actions && !loading && <div className="k-card__actions">{actions}</div>}
      </div>
      {children != null && !loading && !isEmpty && <div className="k-card__body">{children}</div>}
      {hasFoot && <div className="k-card__foot">{foot}</div>}
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

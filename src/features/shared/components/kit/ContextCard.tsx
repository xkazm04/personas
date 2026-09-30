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
  state?: KitStates;
  /** Rendered in place of meta and figures when the state is `empty`. */
  empty?: EmptySpec;
  /** Present = the card selects: its title becomes a button whose hit area is the whole card. */
  onPress?: () => void;
  testId?: string;
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
 * @catalog ContextCard - one of few peers as a tile: a band on a rail, head on top (art top-right), figures on the foot; ContextCards grids them. Kit.
 */
export function ContextCard({ title, meta, figures, actions, art, mark, state, empty, onPress, testId }: ContextCardProps) {
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
      ? <button type="button" className="k-card__title k-card__press typo-body k-strong" aria-pressed={selected} onClick={onPress}>{title}</button>
      : <div className="k-card__title typo-body k-strong">{title}</div>;
  const line = loading ? <Ghost width="40%" height="8px" /> : isEmpty ? empty?.title : meta;
  const foot = loading
    ? <><Ghost width="44px" inline /><Ghost width="72px" inline /></>
    : isEmpty
      ? <>{empty?.hint && <span className="typo-caption">{empty.hint}</span>}{empty?.action}</>
      : figures;
  return (
    <div className={cx('k-card', stateClass(state), onPress && 'is-pressable')} {...kitAttrs('ContextCard', state)} data-testid={testId}>
      {cardMark}
      <div className="k-card__head">
        <div className="k-card__titles">
          {name}
          {line != null && line !== '' && <div className="k-card__meta typo-caption">{line}</div>}
        </div>
        {art && !loading && <div className="k-card__art" aria-hidden="true">{art}</div>}
        {actions && !loading && <div className="k-card__actions">{actions}</div>}
      </div>
      <div className="k-card__foot">{foot}</div>
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

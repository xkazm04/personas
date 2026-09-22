import type { ChapterTurn } from './useChapterScroll';

interface DocumentTurnHintProps {
  turn: ChapterTurn;
  /** Which edge of the leaf this hint sits at. */
  edge: 'next' | 'prev';
  /** "Keep scrolling for 2 · Boundaries", already worded by the caller. */
  label: string | null;
}

/**
 * @catalog DocumentTurnHint — the edge-of-chapter cue that fills as the reader keeps scrolling past the end (or top) of a DocumentSurface chapter, and turns the page when full. Part of DocumentSurface, not a standalone primitive.
 *
 * Present at the edge whenever there is a chapter beyond it, quiet until the
 * reader scrolls into it — so the gesture is discoverable before it is used,
 * and a page never turns without the reader having watched the fill.
 */
export function DocumentTurnHint({ turn, edge, label }: DocumentTurnHintProps) {
  if (!label) return null;
  const live = turn?.direction === edge;
  const progress = live ? turn.progress : 0;
  return (
    <div
      className={`ds-turn ds-turn-${edge} ${live ? 'is-live' : ''}`}
      aria-hidden
      data-testid={`document-turn-${edge}`}
      data-progress={progress.toFixed(2)}
    >
      <span className="ds-turn-label">{label}</span>
      <span className="ds-turn-track">
        <span className="ds-turn-fill" style={{ transform: `scaleX(${progress})` }} />
      </span>
    </div>
  );
}

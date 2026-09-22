import { weightOf, type DocumentSection } from './documentModel';

interface DocumentClosedRowProps {
  section: DocumentSection;
  index: number;
  onOpen: (id: string) => void;
  /** "LAW" / "SELF" — the author mark, already worded by the caller. */
  mark: string;
  /** Localised "<n> lines", already formatted by the caller. */
  linesLabel: (lines: number) => string;
  /** Localised "<n> waiting", already formatted by the caller. */
  waitingLabel: (count: number) => string;
  /** Shown when this section holds an unsaved draft. */
  draftLabel?: string;
}

/**
 * @catalog DocumentClosedRow — one muted single-line row for a section that is not open, so the whole document stays in view. Part of DocumentSurface, not a standalone primitive.
 *
 * A section that is not the one being read: a closed leaf — present, quiet,
 * one line, one click from open. It keeps its author's stitched edge and a
 * wash of its colour, so the stack still says whose hand each chapter is in.
 * Styled by `documentSurface.css` (`.ds-shut`), ported from the contest winner.
 */
export function DocumentClosedRow({
  section,
  index,
  onOpen,
  mark,
  linesLabel,
  waitingLabel,
  draftLabel,
}: DocumentClosedRowProps) {
  const pending = section.pendingCount ?? 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(section.id)}
      className={`focus-ring ds-shut ds-tone-${section.author}`}
      data-role="doc-closed"
      data-testid={`document-closed-${section.id}`}
    >
      <span className="ds-shut-n">{index + 1}</span>
      <span className="ds-shut-t">{section.heading}</span>
      <span className="ds-shut-meta">
        <span className="ds-shut-mark">{mark}</span>
        <span>{linesLabel(weightOf(section.body))}</span>
        {draftLabel && <span className="ds-shut-mark">{draftLabel}</span>}
        {pending > 0 && (
          <span className="ds-shut-pend" data-testid={`document-closed-pending-${section.id}`}>
            {waitingLabel(pending)}
          </span>
        )}
      </span>
    </button>
  );
}

import { AUTHOR_TONE } from './documentTokens';
import { weightOf, type DocumentSection } from './documentModel';

interface DocumentClosedRowProps {
  section: DocumentSection;
  index: number;
  onOpen: (id: string) => void;
  /** Localised "<n> lines", already formatted by the caller. */
  linesLabel: (lines: number) => string;
  /** Localised "<n> waiting", already formatted by the caller. */
  waitingLabel: (count: number) => string;
  /** How the author reads in words, e.g. "your hand" / "the agent's". */
  authorLabel: string;
}

/**
 * @catalog DocumentClosedRow — one muted single-line row for a section that is not open, so the whole document stays in view. Part of DocumentSurface, not a standalone primitive.
 *
 * A section that is not the one being read: one quiet line, present but muted.
 *
 * This is the half of the owner's brief that the rail alone does not satisfy —
 * the whole document stays in one view, with the open section at full measure
 * and every other section still visible and one click away, rather than
 * paginated out of existence. Nothing hides; nothing shouts.
 */
export function DocumentClosedRow({
  section,
  index,
  onOpen,
  linesLabel,
  waitingLabel,
  authorLabel,
}: DocumentClosedRowProps) {
  const tone = AUTHOR_TONE[section.author];
  const pending = section.pendingCount ?? 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(section.id)}
      className="focus-ring group flex w-full items-center gap-3 rounded-card border border-primary/10 border-l-2 bg-secondary/20 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
      style={{ borderLeftColor: 'currentColor' }}
      data-testid={`document-closed-${section.id}`}
    >
      <span className={`typo-label ${tone.text}`}>{index + 1}</span>
      <span className="typo-title flex-1 text-foreground">{section.heading}</span>
      <span className={`typo-label ${tone.text}`}>{authorLabel}</span>
      <span className="typo-label text-foreground">{linesLabel(weightOf(section.body))}</span>
      {pending > 0 && (
        <span
          className={`typo-label rounded-pill px-2 py-0.5 ${tone.wash} ${tone.text}`}
          data-testid={`document-closed-pending-${section.id}`}
        >
          {waitingLabel(pending)}
        </span>
      )}
    </button>
  );
}

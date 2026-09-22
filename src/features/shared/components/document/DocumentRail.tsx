import type { ReactNode } from 'react';
import { AUTHOR_TONE } from './documentTokens';
import { railBands, weightOf, type DocumentSection } from './documentModel';

interface DocumentRailProps {
  sections: readonly DocumentSection[];
  openId: string;
  onOpen: (id: string) => void;
  label: string;
  /** Rendered above the bands — a title, a count, a timestamp. */
  header?: ReactNode;
  /** Rendered under the bands, pinned to the bottom of the rail. */
  footer?: ReactNode;
  /** Localised "<n> lines", already formatted by the caller. */
  linesLabel: (lines: number) => string;
}

/**
 * @catalog DocumentRail — DocumentSurface's optional side panel: one band per section, its height the section's real line count. Part of DocumentSurface, not a standalone primitive.
 *
 * The document drawn to scale — one band per section, its HEIGHT the section's
 * real line count.
 *
 * This is the half of the design that survives growth. A list of five equal
 * rows says the same thing whether a section holds four lines or four hundred;
 * a band drawn from the line count shows the shape of the document before the
 * reader has scrolled anything, and keeps showing it at 22 KB and at 150 KB.
 */
export function DocumentRail({
  sections,
  openId,
  onOpen,
  label,
  header,
  footer,
  linesLabel,
}: DocumentRailProps) {
  const bands = railBands(sections);

  return (
    <nav
      aria-label={label}
      className="flex flex-col gap-2 border-r border-primary/10 pr-3"
      data-testid="document-rail"
    >
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        {sections.map((section, i) => {
          const tone = AUTHOR_TONE[section.author];
          const open = section.id === openId;
          const pending = section.pendingCount ?? 0;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onOpen(section.id)}
              style={{ flexGrow: bands[i] ?? 1 }}
              aria-current={open ? 'true' : undefined}
              className={`focus-ring relative flex min-h-11 basis-0 flex-col justify-end overflow-hidden rounded-input border px-2 py-1.5 text-left transition-colors ${
                open ? `${tone.wash} ${tone.ring}` : 'border-transparent hover:bg-secondary/30'
              }`}
              data-testid={`document-rail-band-${section.id}`}
            >
              <span className={`absolute inset-y-0 left-0 w-0.5 ${tone.edge} ${open ? '' : 'opacity-40'}`} />
              {pending > 0 && (
                <span
                  className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-pill ${tone.edge}`}
                  data-testid={`document-rail-pending-${section.id}`}
                />
              )}
              <span className={`typo-title ${open ? tone.text : 'text-foreground'}`}>
                <span className="typo-label mr-1.5">{i + 1}</span>
                {section.heading}
              </span>
              <span className="typo-label text-foreground">{linesLabel(weightOf(section.body))}</span>
            </button>
          );
        })}
      </div>
      {footer}
    </nav>
  );
}

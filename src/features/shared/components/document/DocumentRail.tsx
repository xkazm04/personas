import type { ReactNode } from 'react';
import { railBands, weightOf, type DocumentSection } from './documentModel';

interface DocumentRailProps {
  sections: readonly DocumentSection[];
  openId: string;
  onOpen: (id: string) => void;
  label: string;
  /** The rail's caption, e.g. "The document" / "to scale". */
  caption?: { title: string; aside?: string };
  /** Rendered above the bands — a persona name, a count, a timestamp. */
  header?: ReactNode;
  /** Rendered under the bands, pinned to the bottom of the rail. */
  footer?: ReactNode;
  /** "LAW · 21 lines" — the caller formats it. */
  meta: (section: DocumentSection, lines: number) => string;
}

/**
 * @catalog DocumentRail — DocumentSurface's optional side panel: one band per section, its height the section's real line count. Part of DocumentSurface, not a standalone primitive.
 *
 * The document drawn to scale — one band per section, its HEIGHT the section's
 * real line count, tinted and edged in its author's colour, notched where a
 * change is waiting. Styled by `documentSurface.css` (`.ds-band`), ported from
 * the contest winner and held to its measured contract.
 *
 * This is the half of the design that survives growth. A list of five equal
 * rows says the same thing whether a section holds four lines or four hundred;
 * a band drawn from the line count shows the shape of the document before the
 * reader has scrolled anything, and keeps showing it at 22 KB and at 150 KB.
 */
export function DocumentRail({ sections, openId, onOpen, label, caption, header, footer, meta }: DocumentRailProps) {
  const bands = railBands(sections);

  return (
    <nav aria-label={label} className="flex h-full min-h-0 flex-col" data-testid="document-rail">
      {header}
      {caption && (
        <div className="ds-rail-cap">
          <span>{caption.title}</span>
          {caption.aside && <span>{caption.aside}</span>}
        </div>
      )}
      <div className="ds-rail-track flex-1">
        {sections.map((section, i) => {
          const here = section.id === openId;
          const pending = section.pendingCount ?? 0;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onOpen(section.id)}
              style={{ flexGrow: bands[i] ?? 1 }}
              aria-current={here ? 'true' : undefined}
              className={`focus-ring ds-band ds-tone-${section.author} ${here ? 'is-here' : ''}`}
              data-testid={`document-rail-band-${section.id}`}
            >
              {pending > 0 && (
                <span className="ds-notch" data-testid={`document-rail-pending-${section.id}`} />
              )}
              <span className="ds-band-n">{i + 1}</span>
              <span className="ds-band-t" data-role="doc-band-title">
                {section.heading}
              </span>
              <span className="ds-band-m">{meta(section, weightOf(section.body))}</span>
            </button>
          );
        })}
      </div>
      {footer}
    </nav>
  );
}

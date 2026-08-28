/** SectionLabels — the typography strategy for the configurator, in one place.
 *  A column TITLE clearly dominates the content beneath it; FIELD markers read as
 *  quiet overlines, not more body text:
 *   • Column title  → typo-section-title  (1.125rem, tinted)  — dominant anchor
* • Field marker → typo-label (0.75rem) — quiet overline
 *  (Content is typo-body; descriptions are typo-caption — see the leaf components.)
 */

/** Column title — the dominant tier that anchors each column. A real heading,
 *  not a styled span: it is the only structure a screen reader can use to tell
 *  the modal's three columns apart (the dialog's own h2 is the surface title). */
export function SectionHeader({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h3 id={id} className="typo-section-title">{children}</h3>;
}

/** Field marker — a quiet uppercase overline, deliberately below the content. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="typo-label text-foreground/85">{children}</span>;
}

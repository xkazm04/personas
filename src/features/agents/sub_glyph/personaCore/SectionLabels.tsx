/** SectionLabels — the typography strategy for the configurator, in one place.
 *  A column TITLE clearly dominates the content beneath it; FIELD markers read as
 *  quiet overlines, not more body text:
 *   • Column title  → typo-section-title  (1.125rem, tinted)  — dominant anchor
 *   • Field marker  → typo-label uppercase (0.75rem)          — quiet overline
 *  (Content is typo-body; descriptions are typo-caption — see the leaf components.)
 */

/** Column title — the dominant tier that anchors each column. */
export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <span className="typo-section-title">{children}</span>;
}

/** Field marker — a quiet uppercase overline, deliberately below the content. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="typo-label uppercase tracking-[0.15em] text-foreground/85">{children}</span>;
}

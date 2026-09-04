/**
 * Markdown density variants — one place for "how markdown reads on a surface".
 *
 * WHY THIS IS A COMPONENT MAP AND NOT A CLASS STRING
 * --------------------------------------------------
 * Every surface that wanted denser or calmer markdown used to hand
 * `MarkdownRenderer` a `className` full of descendant-selector overrides
 * (`[&_h2]:typo-heading [&_p]:mb-2 …`). Half of that convention does not
 * compile. `typo-*` are plain CSS rules in `src/styles/typography.css`, not
 * Tailwind `@utility` declarations, so Tailwind cannot generate an arbitrary
 * variant for them: `[&_p]:mb-5` and `[&_h1]:text-foreground` are emitted,
 * `[&_h1]:typo-heading-lg` and `[&_h3]:typo-label` are not. Verified against
 * the built stylesheet, not inferred.
 *
 * The consequence is that the *typographic* half of the practice — the half
 * that decides whether a markdown heading steps correctly beneath the app's
 * own section titles — was silently dropped at every call site that declared
 * it, while the spacing half worked. So a surface got the rhythm it asked for
 * and the type scale of whatever `MarkdownRenderer` happened to default to.
 *
 * A density therefore has to be expressed as classes on the ELEMENT, which is
 * what this file holds and what `MarkdownRenderer` now builds its component
 * map from. Spacing keeps working exactly as before; type tokens start working
 * for the first time.
 *
 * ADDING A VARIANT: add a key, override only the elements whose treatment
 * actually differs, and adopt it at two or more call sites. A variant with one
 * caller is a `className`, not a variant.
 */

/** Which reading density a surface wants. */
export type MarkdownVariant = 'default' | 'document' | 'card';

/**
 * Per-element class strings the renderer stamps onto its markdown output.
 * Every field is required so a new variant cannot forget an element and
 * silently inherit a density it never chose — variants are built by spreading
 * {@link MARKDOWN_DEFAULT_DENSITY}, which is the only place a default lives.
 */
export interface MarkdownDensity {
  /** Extra classes for the renderer's own wrapper, before the caller's `className`. */
  root: string;
  h1: string;
  h2: string;
  h3: string;
  p: string;
  ul: string;
  ol: string;
  li: string;
  /** Inline `code`, not a fenced block. */
  code: string;
  /** A fenced block's `code` element when the renderer owns no header bar. */
  codeBlock: string;
  /** A fenced block's `code` element under `codeBlockActions` (the shell owns the chrome). */
  codeBlockBare: string;
  pre: string;
  blockquote: string;
  a: string;
  hr: string;
  table: string;
  th: string;
  td: string;
  img: string;
  strong: string;
  em: string;
}

/**
 * The renderer's historical treatment, unchanged.
 *
 * This is the `default` variant and it is byte-for-byte what
 * `MarkdownRenderer` emitted before variants existed, so the ~60 call sites
 * that pass no `variant` render identically. Do not "tidy" these strings: the
 * generous heading top-margins, the primary/accent heading tints and the
 * violet blockquote are the chat transcript's look, and the chat is the
 * majority consumer.
 */
export const MARKDOWN_DEFAULT_DENSITY: MarkdownDensity = {
  root: '',
  // Generous top spacing on headings — markdown bodies read better when each
  // section is visually offset from the prior paragraph, not just stacked
  // tightly. Bottom margin stays moderate so the heading still hugs its body.
  h1: 'typo-heading-lg text-primary mb-3 mt-10 first:mt-0 pb-1.5 border-b border-primary/20',
  h2: 'text-[15px] font-semibold text-primary/90 mb-2.5 mt-8 first:mt-0',
  h3: 'typo-heading text-accent mb-2 mt-6 first:mt-0 tracking-wide',
  p: 'typo-body text-foreground mb-3 leading-relaxed',
  ul: 'list-disc pl-5 space-y-1.5 mb-3 typo-body text-foreground',
  ol: 'list-decimal pl-5 space-y-1.5 mb-3 typo-body text-foreground',
  li: 'text-foreground',
  code: 'px-1.5 py-0.5 bg-primary/8 border border-primary/12 rounded typo-code text-primary/70',
  codeBlock: 'block p-4 bg-background/60 border border-primary/10 rounded-xl typo-code overflow-x-auto',
  codeBlockBare: 'block p-4 typo-code',
  pre: 'mb-3',
  blockquote:
    'border-l-2 border-violet-500/30 pl-4 pr-3 py-2 italic text-foreground/90 my-3 bg-violet-500/5 rounded-r-lg',
  a: 'text-primary hover:underline',
  hr: 'border-border/30 my-4',
  // Tables — visible-but-subtle borders and a faint surface tint so the grid
  // reads as a discrete data block. `bg-foreground/[0.03]` is dark in dark mode
  // and light in light mode (the foreground token inverts with the theme), so a
  // single rule covers both.
  table:
    'w-full typo-body my-4 border-separate border-spacing-0 overflow-hidden rounded-card border border-foreground/15 bg-foreground/[0.03]',
  th: 'text-left typo-label text-foreground/85 px-3 py-2 border-b border-foreground/20 bg-foreground/[0.05]',
  td: 'px-3 py-2 text-foreground/90 border-b border-foreground/10 last:border-b-0',
  img: 'max-w-full h-auto rounded-lg my-2 border border-border/20',
  strong: 'font-bold text-foreground',
  em: 'italic text-foreground',
};

/**
 * A long-form reading surface: a report, a manifest, a note — anything the
 * reader reads top to bottom rather than scans.
 *
 * The decisions, all of them lifted from the reference implementation
 * (`overview/sub_reports/.../ReportDetailModal.tsx`, section I):
 *
 *  1. Headings step DOWN the app's own scale and are never primary- or
 *     accent-tinted. The surface supplies its own title; a markdown heading
 *     inside it is subordinate to that title, so `h1` → `typo-heading-lg`,
 *     `h2` → `typo-heading`, `h3` → `typo-label`, all on `text-foreground`.
 *     This is the half that never compiled before.
 *  2. No rule under `h1`. The renderer's default underlines every `h1`, which
 *     reads as a page break in the middle of a card.
 *  3. Prose at full contrast and open rhythm — paragraphs at `mb-4`, lists at
 *     `my-4`, fenced blocks at `my-5`, so sections breathe.
 *  4. A quiet blockquote: no italic, no violet wash, a primary hairline. A
 *     quotation in a report is evidence, not decoration.
 *  5. Links carry a standing underline. In a document the reader needs to see
 *     what is a link without hovering it.
 *  6. Code chips take the surface's own tint (`bg-foreground/[0.06]`) rather
 *     than the primary wash, so an inline identifier does not read as a link.
 */
export const MARKDOWN_DOCUMENT_DENSITY: MarkdownDensity = {
  ...MARKDOWN_DEFAULT_DENSITY,
  h1: 'typo-heading-lg text-foreground mb-3 mt-8 first:mt-0',
  h2: 'typo-heading text-foreground mb-2 mt-7 first:mt-0',
  // /85, not the /80 the reference call site wrote: `custom/no-low-contrast-text-classes`
  // puts the floor at ~85% and a heading in a reading surface is not the place
  // to sit under it. The difference is imperceptible; the rule is not.
  h3: 'typo-label text-foreground/85 mb-1.5 mt-5 first:mt-0',
  p: 'typo-body text-foreground mb-4 last:mb-0 leading-relaxed',
  ul: 'list-disc pl-5 space-y-1.5 my-4 typo-body text-foreground',
  ol: 'list-decimal pl-5 space-y-1.5 my-4 typo-body text-foreground',
  li: 'text-foreground mb-1.5',
  code: 'px-1.5 py-0.5 bg-foreground/[0.06] border border-primary/12 rounded typo-code text-foreground/90',
  pre: 'my-5',
  blockquote:
    'border-l-[3px] border-primary/40 px-5 py-2 text-foreground/85 my-5 bg-transparent',
  a: 'text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary',
};

/**
 * Prose inside a dense card — a review row, an approval, a proposal: a block
 * the reader scans among siblings rather than settles into.
 *
 * Same rules as `document`, tightened: every vertical rhythm halves, and the
 * heading scale flattens one tier further (`h1`/`h2` share `typo-heading`)
 * because a card is already inside somebody else's heading and a three-tier
 * hierarchy inside it is noise. Lifted from the same reference file's
 * pending-decisions section (IV).
 */
export const MARKDOWN_CARD_DENSITY: MarkdownDensity = {
  ...MARKDOWN_DEFAULT_DENSITY,
  root: 'typo-body text-foreground',
  h1: 'typo-heading text-foreground mb-1 mt-3 first:mt-0',
  h2: 'typo-heading text-foreground mb-1 mt-3 first:mt-0',
  h3: 'typo-label text-foreground/85 mb-1 mt-2 first:mt-0',
  p: 'typo-body text-foreground mb-2 last:mb-0 leading-relaxed',
  ul: 'list-disc pl-5 space-y-1 my-2 typo-body text-foreground',
  ol: 'list-decimal pl-5 space-y-1 my-2 typo-body text-foreground',
  pre: 'my-2',
  blockquote:
    'border-l-2 border-primary/30 pl-3 pr-2 py-1.5 text-foreground/85 my-2 bg-transparent',
};

const DENSITIES: Record<MarkdownVariant, MarkdownDensity> = {
  default: MARKDOWN_DEFAULT_DENSITY,
  document: MARKDOWN_DOCUMENT_DENSITY,
  card: MARKDOWN_CARD_DENSITY,
};

/** Resolve a variant name to its density. An unknown name falls back to `default`. */
export function markdownDensity(variant: MarkdownVariant = 'default'): MarkdownDensity {
  return DENSITIES[variant] ?? MARKDOWN_DEFAULT_DENSITY;
}

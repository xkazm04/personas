/**
 * The Lens header: ONE component on every plane, with a fixed height (the
 * owner's requirement, 2026-10-16: the winner rebuilt its head per hover and
 * per level, and the field under it moved).
 *
 * Fixed slots, each always rendered, each its own fixed size:
 *   mark     96px, always reserved (portfolio mark, project sigil, step icon)
 *   eyebrow  one line, ellipsis
 *   title    one line, ellipsis
 *   lede     exactly two lines tall, clamped; the whole text in a tooltip
 *   readout  one line, reserved even when empty: what the pointer is on
 *   aside    the focused project's actions (Measure, the Overseer, Ask Athena,
 *            Install), wrapping inside the header's height, never growing it
 *
 * A hover rewrites only the readout, by opacity. `lens.css` pins the height;
 * `lensHeader.test.tsx` asserts no slot is ever left out.
 */
import { memo, type ReactNode } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { useLensPointer, type LensPointer } from './lensPointer';

/** Holds an empty line at its height, so a slot with nothing to say is still a slot. */
export const NBSP = ' ';

export interface LensHead {
  mark: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  lede: string;
  /** Said when nothing is pointed at: a hint, the project's practice and freshness, or nothing. */
  idle: ReactNode;
}

/** The readout reads the pointer itself, so a hover re-renders this line only. */
function Readout({ say, idle }: { say: (p: LensPointer) => string | null; idle: ReactNode }) {
  const hover = useLensPointer((s) => s.hover);
  const text = hover ? say(hover) : null;
  return (
    <p className="lens-line lens-head-readout typo-caption" aria-live="polite" data-testid="lens-head-readout">
      <span key={text ?? 'idle'}>{text ?? (idle || NBSP)}</span>
    </p>
  );
}

export const LensHeader = memo(function LensHeader({ head, say, aside }: {
  head: LensHead;
  say: Parameters<typeof Readout>[0]['say'];
  /** The focused project's actions, in the header's right column (empty on the portfolio planes). */
  aside?: ReactNode;
}) {
  return (
    <header className="lens-head" data-testid="lens-head">
      <div className="lens-head-mark">{head.mark}</div>
      <div className="lens-head-text">
        <p className="lens-line lens-head-eyebrow typo-label" data-testid="lens-head-eyebrow">{head.eyebrow}</p>
        {/* The plane's headline, a heading under the page (the page's own name is the trail's
            "Lifecycle"): a section heading, not the page-frame title ContentHeader owns. */}
        <h2 className="lens-line lens-head-title typo-hero" data-testid="lens-head-title">{head.title}</h2>
        <Tooltip content={head.lede}>
          <p className="lens-head-lede typo-body-lg" data-testid="lens-head-lede">{head.lede || NBSP}</p>
        </Tooltip>
        <Readout say={say} idle={head.idle} />
      </div>
      <div className="lens-head-aside">{aside}</div>
    </header>
  );
});

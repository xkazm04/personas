import type { ReactNode } from 'react';
import { cx, kitAttrs } from './types';

/** How far apart the regions sit; `divided` draws the rule in the same gap. */
export type StackGap = 's' | 'm' | 'l';

/**
 * Stack: the REGIONS inside a Tile or a ContextCard - a paragraph, then bullets, then a stat
 * strip, then rows - with the gap between them and, with `divided`, a quiet rule separating them.
 *
 * Why a part and not a rule on `.k-dtile__body > * + *` (grow-4, part 3). A sibling rule cannot
 * tell a region boundary from a continuation: `Rows` returns its list AND its pager as two direct
 * children of the body, so a blanket rule draws a line between a list and its own "Show all", and
 * every tile in the app changes whether its author wanted structure or not. A Stack knows exactly
 * where the boundaries are because the caller put them there - no `:has()`, no sibling guessing,
 * nothing changes until a surface asks for it - and it works identically in a Tile body, a card
 * body and a Section body. It also retires the hand-rolled
 * `style={{display:'flex',flexDirection:'column',gap:N}}` that regions inside a tile were using.
 *
 * The rule is a RULE, not a border box: it is painted as a background gradient on each region
 * after the first, starting where its host's band starts (`--band-x`), so it adds no edge on the
 * left or right, nothing boxes the content, and the row band underneath is untouched. One colour
 * token (`--rule`) stepped from the background's own lightness, so it is correct on both themes.
 * @catalog Stack - stacked regions inside a Tile or a card: owns the gap and, with `divided`, a quiet rule between them on the band's reading line. Kit.
 */
export function Stack({ gap = 'm', divided, children }: {
  gap?: StackGap;
  /** Draw a quiet rule between the regions (not a box, and never around them). */
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('k-stack', `k-stack--${gap}`, divided && 'k-stack--divided')} {...kitAttrs('Stack')}>
      {children}
    </div>
  );
}

// A companion's mark in a menu row's 14px icon slot, carrying ITS OWN STATE.
//
// The glyphs themselves (`src/features/companions/companionGlyphs.tsx`) have
// one appearance each, on purpose: their first cut thickened strokes for the
// on state and, rendered on the 16/20/24/48px ladder in both themes, the two
// states were nearly indistinguishable at 16px - the only size this menu uses.
// So state is the CALLER's job, and this is that caller. ON puts the mark on a
// filled chip in the primary tint with the glyph knocked out in the surface
// colour, which reads instantly at menu size; OFF is the bare glyph in the
// row's own ink. Evidence: C:\Users\kazda\AppData\Local\Temp\claude\marks\glyphs2.png.
//
// Never opacity for the difference - the style doctrine forbids spending
// opacity on meaning, and a dimmed glyph at 14px is simply a lost glyph.
//
// Sized to the ContextMenu icon slot exactly (`w-3.5 h-3.5`), so a menu whose
// rows mix lucide icons and companion marks keeps one label column.

import { COMPANION_GLYPH } from '@/features/companions/companionGlyphs';

/** The two companions addressable from the Activity board. Curator has no verb here. */
export type MarkCompanion = 'athena' | 'overseer';

export function CompanionMark({ companion, active }: {
  companion: MarkCompanion;
  /** The verb's current state: flagged for Athena / starred for Overseer. */
  active: boolean;
}) {
  const Glyph = COMPANION_GLYPH[companion];
  if (!active) return <Glyph className="h-3.5 w-3.5" />;
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-interactive bg-primary text-background">
      <Glyph className="h-2.5 w-2.5" />
    </span>
  );
}

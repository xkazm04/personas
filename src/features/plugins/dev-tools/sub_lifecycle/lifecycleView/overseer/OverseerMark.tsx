// The Overseer's mark as the module draws it: his companion glyph on a chip in
// his role colour (the agent role every Overseer control already wears). The
// glyph carries no state of its own (`companionGlyphs`: state is the
// caller's), so ON is the FILLED chip and off is the bare glyph on a hairline.
// One size per job, from the module's glyph scale: `sm` on a rail card and in
// a row, `md` at the head of the goal panel.
import { COMPANION_GLYPH } from '@/features/companions/companionGlyphs';

import { GLYPH } from '../system/scales';

const OverseerGlyph = COMPANION_GLYPH.overseer;

const BOX = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
} as const;

export function OverseerMark({ size = 'sm', on = true }: { size?: keyof typeof BOX; on?: boolean }) {
  const look = on
    ? 'border border-role-agent/40 bg-role-agent/15 text-role-agent'
    : 'border border-primary/20 text-foreground';
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-interactive ${BOX[size]} ${look}`} data-overseer-mark={on ? 'on' : 'off'}>
      <OverseerGlyph className={size === 'md' ? GLYPH.md : GLYPH.sm} />
    </span>
  );
}

export { OverseerGlyph };

/**
 * Fusion · the attention signal (Filament's beads, restyled per the owner):
 * the FIRST thing waiting on you is a larger glowing circle with the glyph of
 * its kind inside it and a warm warning-yellow glow where Filament drew a
 * black knock-out border; it breathes while it waits (gated on reduced
 * motion). The rest queue under it as small beads in their kind's colour.
 * Each bead opens its own item; the big one opens the first. With nothing
 * waiting, the circle goes hollow and still with a check inside.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { Check } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { NEXT_COPY as N } from '../../../nextCopy';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import { KIND_GLYPH } from './kindGlyph';
import { FUSION_COPY as F } from './copy';

const SHOWN = 5;

export function AttentionBeads({ items, onOpen }: { items: WorkItem[]; onOpen: (id: string | null) => void }) {
  const { shouldAnimate } = useMotion();
  const first = items[0] ?? null;
  const rest = items.slice(1, SHOWN);
  const over = items.length - 1 - rest.length;
  const Glyph = first ? KIND_GLYPH[first.kind] : Check;

  return (
    <div className="fu-beads" data-testid="companion-fusion-beads">
      <Tooltip content={first ? `${N.kind[first.kind]} · ${first.project ?? F.athena}` : F.noneWaiting} placement="left">
        <Button
          variant="ghost"
          className={`fu-attn${first ? '' : ' is-quiet'}${first && shouldAnimate ? ' is-moving' : ''}`}
          style={first ? { ['--c' as string]: KIND_VAR[first.kind] } : undefined}
          onClick={() => onOpen(first?.id ?? null)}
          aria-label={first ? `${N.kind[first.kind]}, ${F.openQueue}` : F.noneWaiting}
          data-testid="companion-fusion-attention"
          data-fusion-anchor=""
        >
          <Glyph aria-hidden />
        </Button>
      </Tooltip>
      {rest.map((it) => (
        <Tooltip key={it.id} content={`${N.kind[it.kind]} · ${it.project ?? F.athena}`} placement="left">
          <Button
            variant="ghost"
            className="fu-bead"
            style={{ ['--c' as string]: KIND_VAR[it.kind] }}
            onClick={() => onOpen(it.id)}
            aria-label={N.kind[it.kind]}
          >
            <i aria-hidden />
          </Button>
        </Tooltip>
      ))}
      {over > 0 && <span className="typo-caption fu-over">{F.more(over)}</span>}
    </div>
  );
}

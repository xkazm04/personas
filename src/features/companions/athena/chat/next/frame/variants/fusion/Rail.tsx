/**
 * Fusion · the right rail - ONE compact instrument on one lit line, top to
 * bottom:
 *   1. how many decisions wait on you, large (R5 · C's margin count);
 *   2. the attention signal: the first waiting item as a glowing circle with
 *      its glyph, the rest as beads (Filament's beads, restyled);
 *   3. what Athena manages, one circle per category in its own ink, ringed by
 *      its items' states (Current's side panel, in Filament's slim language),
 *      each unfolding into its panel;
 *   4. her toolset (`AthenaToolbar dock="single"`), which grows on hover or
 *      focus exactly as Filament's does.
 * The line takes the theme's own accent (`--primary`), not a fixed hue.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence } from 'framer-motion';
import { useRef, useState } from 'react';
import { Check, Hand } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { AthenaToolbar } from '../../../../../AthenaToolbar';
import type { WorkItem } from '../../../useWorkforce';
import { AttentionBeads } from './AttentionBeads';
import { CategoryCircle } from './CategoryCircle';
import { CategoryPanel } from './CategoryPanel';
import { FUSION_COPY as F } from './copy';
import type { CategoryKey, ManagedCategory } from './useManaged';

const PANEL_MAX = 380;

export function Rail({
  items,
  categories,
  onOpenItem,
}: {
  items: WorkItem[];
  categories: ManagedCategory[];
  onOpenItem: (id: string | null) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const circles = useRef(new Map<CategoryKey, HTMLButtonElement>());
  const [open, setOpen] = useState<{ key: CategoryKey; top: number; keyboard: boolean } | null>(null);
  const active = open ? (categories.find((c) => c.key === open.key) ?? null) : null;
  const n = items.length;

  const toggle = (key: CategoryKey, keyboard: boolean) => {
    if (open?.key === key) {
      setOpen(null);
      return;
    }
    const rail = railRef.current?.getBoundingClientRect();
    const seat = railRef.current?.parentElement?.getBoundingClientRect();
    const btn = circles.current.get(key)?.getBoundingClientRect();
    const centre = rail && btn ? btn.top + btn.height / 2 - rail.top : 0;
    // The panel may run below the rail itself, down to the seat's foot.
    const room = seat && rail ? seat.bottom - rail.top - PANEL_MAX : 0;
    // Hangs just under the circle's centre, clear of the circle's own tooltip above it.
    setOpen({ key, top: Math.max(0, Math.min(centre - 12, room)), keyboard });
  };
  const close = () => {
    const key = open?.key;
    setOpen(null);
    if (key) circles.current.get(key)?.focus({ preventScroll: true });
  };

  return (
    <div className="fu-rail-seat">
      <nav ref={railRef} className="fu-rail fu-glass" aria-label={F.rail} data-testid="companion-fusion-rail">
        <span className={`fu-line${n ? ' is-waiting' : ''}`} aria-hidden />
        <Tooltip content={`${n ? F.pendingNamed(n) : F.noneWaiting} · ${F.keyWork}`} placement="left">
          <Button
            variant="ghost"
            className={`fu-count${n ? '' : ' is-quiet'}`}
            onClick={() => onOpenItem(null)}
            aria-keyshortcuts="Alt+W"
            aria-label={`${n ? F.pendingNamed(n) : F.noneWaiting}. ${F.openQueue}`}
            data-testid="companion-fusion-count"
          >
            <span className="typo-data-lg fu-count-n">{n}</span>
            {/* A glyph, not a word: "waiting" does not fit a 54px rail, and a hand
                says "on you" without colour. The words are the label and tooltip. */}
            {n ? <Hand className="fu-count-g" aria-hidden /> : <Check className="fu-count-g" aria-hidden />}
          </Button>
        </Tooltip>
        <AttentionBeads items={items} onOpen={onOpenItem} />
        <span className="fu-rule" aria-hidden />
        <div className="fu-cats" data-testid="companion-fusion-categories">
          {categories.map((c) => (
            <CategoryCircle
              key={c.key}
              ref={(el) => {
                if (el) circles.current.set(c.key, el);
                else circles.current.delete(c.key);
              }}
              category={c}
              open={open?.key === c.key}
              onToggle={() => toggle(c.key, false)}
              onKeyToggle={() => toggle(c.key, true)}
            />
          ))}
        </div>
        <span className="fu-rule" aria-hidden />
        <div className="fu-tools-seat" data-testid="companion-fusion-tools">
          <AthenaToolbar dock="single" className="bg-transparent" />
        </div>
      </nav>
      <AnimatePresence>
        {active && open && <CategoryPanel key={active.key} category={active} top={open.top} focusFirst={open.keyboard} onClose={close} />}
      </AnimatePresence>
    </div>
  );
}

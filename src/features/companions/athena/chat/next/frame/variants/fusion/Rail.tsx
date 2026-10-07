/**
 * Fusion · the right rail - ONE compact instrument on one lit line, top to
 * bottom:
 *   1. how many decisions wait on you, large (R5 · C's margin count);
 *   2. the attention signal: the first waiting item as a glowing circle with
 *      its glyph, the rest as beads (Filament's beads, restyled);
 *   3. what Athena manages, one circle per category in its own ink, ringed by
 *      its items' states (Current's side panel, in Filament's slim language),
 *      each unfolding into its panel;
 *   4. her toolset (`AthenaToolbar dock="single"`).
 * The line takes the theme's own accent (`--primary`), not a fixed hue.
 *
 * Two INDEPENDENT hover and focus zones (`useRailExpand`, one instance each):
 *   - the upper column (count, beads, categories, an open category panel):
 *     hovering or tabbing into it widens ITS glass leftward over the app, every
 *     circle and bead grows in place and gains its words beside it (the pending
 *     count, each bead's kind and title, each category's counts by state);
 *   - the toolset: on its own it grows into a glass panel of its own - bigger
 *     buttons, leftward, no words - and never wakes the upper column.
 * Nothing above the toolset moves vertically and nothing pushes layout; Esc or
 * leaving folds a zone. Reduced motion expands instantly.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence } from 'framer-motion';
import { useRef, useState } from 'react';
import { Hand } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { AthenaToolbar } from '../../../../../AthenaToolbar';
import type { WorkItem } from '../../../useWorkforce';
import { AttentionBeads } from './AttentionBeads';
import { CategoryCircle, countText } from './CategoryCircle';
import { CategoryPanel } from './CategoryPanel';
import { FUSION_COPY as F } from './copy';
import type { CategoryKey, ManagedCategory } from './useManaged';
import { useRailExpand, useRailRoom } from './useRailExpand';

const PANEL_MAX = 380;
/** Beads under the attention circle at most (the rest fold into "+N"). */
const BEADS = 4;
/** What the toolset adds in height when it grows (~96px) less the 36px it may take from the stage's foot below the seat. */
const TOOLS_GROWTH = 56;

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
  const up = useRailExpand('up');
  const tools = useRailExpand('tools');
  const seatRef = useRef<HTMLDivElement>(null);
  const beadCap = useRailRoom(seatRef, railRef, BEADS, TOOLS_GROWTH);
  const { shouldAnimate } = useMotion();

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
    <div
      ref={seatRef}
      className={`fu-rail-seat${up.expanded ? ' is-expanded' : ''}${shouldAnimate ? '' : ' is-still'}`}
    >
      <nav
        ref={railRef}
        className="fu-rail"
        aria-label={F.rail}
        data-testid="companion-fusion-rail"
        data-companion-fusion-rail-expanded={up.expanded ? 'true' : 'false'}
        data-companion-fusion-tools-grown={tools.expanded ? 'true' : 'false'}
      >
        <span className={`fu-line${n ? ' is-waiting' : ''}`} aria-hidden />
        <div className="fu-up" {...up.zoneProps} {...up.handlers}>
        {/* Nothing waiting: no count and no control. The one all-clear mark is the
            attention circle below, and a quiet rail has nothing to open. */}
        {n > 0 && (
          <Button
            variant="ghost"
            className="fu-count"
            onClick={() => onOpenItem(null)}
            aria-keyshortcuts="Alt+W"
            aria-label={`${F.pendingNamed(n)}. ${F.openQueue}`}
            data-testid="companion-fusion-count"
          >
            <span className={`typo-data-lg fu-count-n${countText(n).length > 2 ? ' is-wide' : ''}`}>{countText(n)}</span>
            {/* A glyph, not a word: "waiting" does not fit a 54px rail, and a hand
                says "on you" without colour. The words stand beside it when the rail expands. */}
            <Hand className="fu-count-g" aria-hidden />
            <span className="fu-tag is-row" aria-hidden>
              <span className="typo-label fu-tag-main">{F.pendingLabel(n)}</span>
              <span className="fu-kbd typo-caption">{F.keyWork}</span>
            </span>
          </Button>
        )}
        <AttentionBeads items={items} onOpen={onOpenItem} cap={beadCap} />
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
        </div>
        <div
          className={`fu-tools-seat${tools.expanded ? ' is-grown' : ''}`}
          data-testid="companion-fusion-tools"
          {...tools.zoneProps}
          {...tools.handlers}
        >
          <AthenaToolbar dock="single" className="bg-transparent" />
        </div>
      </nav>
      <AnimatePresence>
        {active && open && <CategoryPanel
            key={active.key}
            category={active}
            top={open.top}
            focusFirst={open.keyboard}
            onClose={close}
            zone={{ ...up.zoneProps, ...up.handlers }}
          />}
      </AnimatePresence>
    </div>
  );
}

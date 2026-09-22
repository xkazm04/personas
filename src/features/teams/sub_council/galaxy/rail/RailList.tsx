// The list body: a flat item stream of subcategory headings and rows, mapped
// straight through while it is small and virtualised once a level is big
// enough that a measure pass pays for itself.
import { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';

import { MOTION_PRESETS } from '@/lib/utils/animation/animationPresets';

import { RailRow } from './RailRow';
import type { RailRow as RailRowModel } from '../useGalaxyRows';

/** Below this many items, plain DOM reads better than a measure pass. */
export const VIRTUALIZE_ABOVE = 150;
const ROW_PX = 34;
const HEADING_PX = 30;

export type RailItem =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'row'; key: string; row: RailRowModel; index: number };

interface Props {
  items: RailItem[];
  selectedIndex: number;
  onSelect: (row: RailRowModel, index: number) => void;
  onHover: (row: RailRowModel | null) => void;
  /**
   * The altitude and node the list is currently OF.
   *
   * A change here is a change of subject, not a change of contents, and it is
   * the thing that has to be animated: the old list leaves and the new one
   * arrives, rather than the rows silently becoming different rows. A filter
   * keystroke deliberately does NOT change it - filtering narrows one list,
   * it does not replace it.
   */
  listKey: string;
}

/**
 * The flip: out to the left, in from the right, on the app's `smooth` rung.
 *
 * 8 px, which is the same distance the app's own `dashboardItem` entrance
 * travels. Framer is gated app-wide by `<MotionConfig reducedMotion="user">`
 * (`App.tsx:371`), so a reader who asked for reduced motion gets the swap
 * with no travel and no fade.
 */
const FLIP = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
  transition: MOTION_PRESETS.smooth.framer,
} as const;

/* `typo-label text-foreground/90` is the app's own section-heading recipe —
   the sidebar's level-2 heading (`Sidebar.tsx:258`). The uppercase,
   0.1em-tracked heading this replaced appears NOWHERE in the app chrome; it
   was the galaxy writing its own type rules. */
function Heading({ label }: { label: string }) {
  return <div className="px-2 pb-1 pt-2.5 typo-label text-foreground/90">{label}</div>;
}

function Item({ item, selectedIndex, onSelect, onHover }: Props & { item: RailItem }) {
  if (item.kind === 'heading') return <Heading label={item.label} />;
  return (
    <RailRow
      row={item.row}
      selected={item.index === selectedIndex}
      onSelect={() => onSelect(item.row, item.index)}
      onHover={(hovering) => onHover(hovering ? item.row : null)}
    />
  );
}

export function RailList(props: Props) {
  const { items, listKey } = props;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualise = items.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: virtualise ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i]?.kind === 'heading' ? HEADING_PX : ROW_PX),
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3.5 pt-1.5">
      {/* `mode="wait"` so the two lists never overlap in a 330 px column:
          the old one leaves, then the new one arrives with the camera. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={listKey} {...FLIP}>
      {virtualise ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index];
            if (!item) return null;
            return (
              <div
                key={item.key}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${v.start}px)` }}
                data-index={v.index}
              >
                <Item {...props} item={item} />
              </div>
            );
          })}
        </div>
      ) : (
        items.map((item) => <Item key={item.key} {...props} item={item} />)
      )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

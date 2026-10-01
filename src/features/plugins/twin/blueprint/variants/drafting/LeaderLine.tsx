import { useLayoutEffect, useState, type RefObject } from 'react';
import { motion } from 'framer-motion';

/**
 * A drafting leader from the notes to the mark they are about, run along the
 * gutter beside the card so it never crosses the card or the drawing: out of
 * the notes' near edge, along the gutter, and into the mark with a dot. A mark
 * that sits over or under the notes (the same column) needs no leader.
 */
export default function LeaderLine({
  rootRef,
  from,
  to,
  playKey,
  reduced,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  from: HTMLElement | null;
  to: HTMLElement | null;
  playKey: string | null;
  reduced: boolean;
}) {
  const [path, setPath] = useState<{ d: string; dot: [number, number] } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !from || !to) {
      setPath(null);
      return;
    }
    const place = () => {
      const r = root.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      if (a.width === 0 || b.width === 0) return setPath(null);
      const ay = a.top - r.top + 18;
      const by = b.top - r.top + b.height / 2;
      if (b.left >= a.right) {
        const x = a.right - r.left;
        return setPath({ d: `M${x} ${ay} H${x + 6} V${by} H${b.left - r.left + 4}`, dot: [b.left - r.left + 4, by] });
      }
      if (b.right <= a.left) {
        const x = a.left - r.left;
        return setPath({ d: `M${x} ${ay} H${x - 6} V${by} H${b.right - r.left - 4}`, dot: [b.right - r.left - 4, by] });
      }
      setPath(null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    ro.observe(to);
    return () => ro.disconnect();
  }, [rootRef, from, to, playKey]);

  if (!path) return null;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible" data-leader="true">
      <motion.path
        key={playKey ?? 'leader'}
        d={path.d}
        fill="none"
        stroke="var(--ink-strong)"
        strokeWidth={1.25}
        initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
        animate={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut', delay: reduced ? 0 : 0.5 }}
      />
      <circle cx={path.dot[0]} cy={path.dot[1]} r={3} fill="var(--ink-strong)" />
    </svg>
  );
}

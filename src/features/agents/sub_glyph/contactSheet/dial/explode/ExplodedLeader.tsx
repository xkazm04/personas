/** The leader from the exploded fan to its controls: it leaves the fan's
 *  lower outer corner, drops clear of the part labels, runs across the gap,
 *  turns, and lands on the controls' bus line with an end dot. Measured from
 *  the live elements (the controls scroll, the stage resizes), drawn on once. */
import { useLayoutEffect, useState, type RefObject } from "react";
import { motion } from "framer-motion";
import { useMotion } from "@/hooks/utility/interaction/useMotion";
import { tint } from "../tint";

export interface LeaderGeometry { d: string; end: { x: number; y: number } }

export function useLeaderGeometry(rootRef: RefObject<HTMLElement | null>, anchor: HTMLElement | null, bus: HTMLElement | null): LeaderGeometry | null {
  const [geo, setGeo] = useState<LeaderGeometry | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !anchor || !bus) { setGeo(null); return; }
    const place = () => {
      const o = root.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      const b = bus.getBoundingClientRect();
      const ax = a.left - o.left, ay = a.top - o.top;
      const bx = b.left - o.left;
      const top = b.top - o.top + 11, bottom = b.bottom - o.top - 11;
      const drop = Math.min(ay + 22, o.height - 6);
      const ty = Math.min(Math.max(drop, top), Math.max(top, bottom));
      const midX = ax + 16 + (bx - ax - 16) * 0.55;
      setGeo({ d: `M${ax} ${ay}L${ax + 16} ${drop}L${midX} ${drop}L${midX} ${ty}L${bx} ${ty}`, end: { x: bx, y: ty } });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    ro.observe(bus);
    root.addEventListener("scroll", place, true);
    return () => { ro.disconnect(); root.removeEventListener("scroll", place, true); };
  }, [rootRef, anchor, bus]);
  return geo;
}

export function ExplodedLeader({ geometry, color }: { geometry: LeaderGeometry; color: string }) {
  const { shouldAnimate } = useMotion();
  return (
    <motion.svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <motion.path
        d={geometry.d} fill="none" stroke={tint(color, 0.55)} strokeWidth={1}
        initial={shouldAnimate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, delay: 0.9, ease: "easeOut" }}
      />
      <circle cx={geometry.end.x} cy={geometry.end.y} r={2.5} fill={color} />
    </motion.svg>
  );
}

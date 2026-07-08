/** PolaritySlider — a 0…1 slider with named poles (e.g. Cautious ↔ Bold).
 *  Keyboard-accessible via the underlying range input; the fill + handle spring to
 *  new values when a preset loads them, but track instantly while dragging (no
 *  rubber-band under the thumb). */
import { useState } from "react";
import { motion } from "framer-motion";

export function PolaritySlider({
  label, lowLabel, highLabel, value, color, onChange,
}: {
  label: string; lowLabel: string; highLabel: string; value: number; color: string;
  onChange: (v: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const pct = Math.round(value * 100);
  const tr = dragging ? { duration: 0 } : { type: "spring" as const, stiffness: 260, damping: 28 };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="typo-label uppercase tracking-[0.15em] text-foreground/85">{label}</span>
        <span className="typo-caption font-mono" style={{ color }}>{pct}</span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-secondary/80 overflow-hidden">
          <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${pct}%` }} transition={tr} />
        </div>
        <motion.div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-background shadow -translate-x-1/2 pointer-events-none"
          style={{ background: color }}
          animate={{ left: `${pct}%` }}
          transition={tr}
        />
        <input
          type="range" min={0} max={100} value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onBlur={() => setDragging(false)}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          aria-label={label}
        />
      </div>
      <div className="flex items-center justify-between typo-caption">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

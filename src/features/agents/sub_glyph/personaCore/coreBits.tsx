/** coreBits — shared primitives for the persona-core configurator.
 *
 *  The lucide icon resolver (carried over from the retired Foundry) plus the two
 *  reusable controls the Character configurator composes: a labeled-pole polarity
 *  slider that springs to preset values (but tracks instantly under a drag), and
 *  a generic segmented control with a sliding highlight (used for both the model
 *  tier and the reasoning-effort rows).
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, BookOpenCheck, Brain, ConciergeBell, LibraryBig, LineChart,
  NotebookPen, Palette, Radar, Rocket, ShieldCheck, Sparkles, Target, Users,
  Workflow, type LucideIcon,
} from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";

const CORE_ICONS: Record<string, LucideIcon> = {
  ShieldCheck, LineChart, Radar, Workflow, Activity, LibraryBig, Palette,
  Rocket, ConciergeBell, Target, Brain, Users, BookOpenCheck, NotebookPen,
};

export function coreIcon(name: string): LucideIcon {
  return CORE_ICONS[name] ?? Sparkles;
}

export const ACCENT = "#60A5FA";

/** A 0…1 slider with named poles (e.g. Cautious ↔ Bold). Keyboard-accessible via
 *  the underlying range input; the fill + handle spring to new values when a preset
 *  loads them, but track instantly while dragging (no rubber-band under the thumb). */
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
        <span className="typo-label uppercase tracking-wider text-foreground">{label}</span>
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

/** A generic segmented control with a shared-layout highlight that slides between
 *  options instead of hard-cutting. `layoutGroup` must be unique per instance so
 *  two segments on screen don't animate into each other. */
export function Segment<T extends string>({
  label, options, value, color, layoutGroup, onChange,
}: {
  label: string;
  options: { id: T; label: string; blurb?: string }[];
  value: T; color: string; layoutGroup: string;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="typo-label uppercase tracking-wider text-foreground">{label}</span>
      <div className="flex gap-1 p-1 rounded-interactive bg-secondary/60">
        {options.map((o) => {
          const active = o.id === value;
          const btn = (
            <button
              type="button"
              onClick={() => onChange(o.id)}
              className={`relative flex-1 w-full px-2 py-1.5 rounded-input typo-caption transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/70 hover:text-foreground"}`}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId={`seg-${layoutGroup}`}
                  className="absolute inset-0 rounded-input"
                  style={{ background: colorWithAlpha(color, 0.22), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(color, 0.5)}` }}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                />
              )}
              <span className="relative z-10">{o.label}</span>
            </button>
          );
          return (
            <div key={o.id} className="flex-1">
              {o.blurb ? <Tooltip content={o.blurb}>{btn}</Tooltip> : btn}
            </div>
          );
        })}
      </div>
    </div>
  );
}

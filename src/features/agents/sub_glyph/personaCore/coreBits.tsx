/** coreBits — shared primitives for the persona-core Console configurator.
 *
 *  The lucide icon resolver (carried over from the retired Foundry) plus the
 *  interactive knobs the Console composes: a labeled-pole polarity slider that
 *  springs to preset values (but tracks instantly under a drag), the model-tier
 *  segment with a sliding highlight, and a compact memory-strategy picker.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, BookOpenCheck, Brain, ConciergeBell, LibraryBig, LineChart,
  NotebookPen, Palette, Radar, Rocket, ShieldCheck, Sparkles, Target, Users,
  Workflow, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { MODEL_TIERS, type ModelTier } from "./usePersonaCore";
import type { MemoryStrategy } from "@/api/archetypes";

const CORE_ICONS: Record<string, LucideIcon> = {
  ShieldCheck, LineChart, Radar, Workflow, Activity, LibraryBig, Palette,
  Rocket, ConciergeBell, Target, Brain, Users, BookOpenCheck, NotebookPen,
};

export function coreIcon(name: string): LucideIcon {
  return CORE_ICONS[name] ?? Sparkles;
}

export const ACCENT = "#60A5FA";

/** A 0…1 slider with named poles (e.g. Cautious ↔ Bold). Keyboard-accessible
 *  via the underlying range input; the track is styled over it. The fill + handle
 *  spring to new values when a preset snapshot loads them, but track instantly
 *  while the user is dragging (so the thumb never rubber-bands under the finger). */
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

/** Fast / Balanced / Max segmented control (Haiku / Sonnet / Opus). */
export function ModelSegment({ value, color, onChange }: { value: ModelTier; color: string; onChange: (m: ModelTier) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="typo-label uppercase tracking-wider text-foreground">Model</span>
      <div className="flex gap-1 p-1 rounded-interactive bg-secondary/60">
        {MODEL_TIERS.map((tier) => {
          const active = tier.id === value;
          return (
            <Tooltip key={tier.id} content={tier.blurb}>
              <button
                type="button"
                onClick={() => onChange(tier.id)}
                className={`relative flex-1 px-2 py-1.5 rounded-input typo-caption transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/70 hover:text-foreground"}`}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="model-seg-active"
                    className="absolute inset-0 rounded-input"
                    style={{ background: colorWithAlpha(color, 0.22), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(color, 0.5)}` }}
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{tier.label}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/** Compact memory-strategy picker — one row per strategy, tooltip carries the
 *  long "what it remembers", a warning chip when the strategy needs setup. */
export function MemoryPicker({
  strategies, value, color, onChange,
}: {
  strategies: MemoryStrategy[]; value: string | null; color: string; onChange: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="typo-label uppercase tracking-wider text-foreground">Memory</span>
      <div className="flex flex-col gap-1">
        {strategies.map((m) => {
          const Icon = coreIcon(m.icon);
          const active = m.id === value;
          const needsSetup = m.requires.length > 0;
          return (
            <Tooltip key={m.id} content={m.whatItRemembers}>
              <button
                type="button"
                onClick={() => onChange(active ? null : m.id)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-input border transition-colors cursor-pointer text-left ${active ? "border-transparent" : "border-card-border/60 hover:border-foreground/25"}`}
                style={active ? { background: colorWithAlpha(color, 0.14), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(color, 0.45)}` } : undefined}
                aria-pressed={active}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: active ? color : undefined }} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="typo-caption text-foreground truncate">{m.name}</span>
                  <span className="typo-caption truncate">{m.bestFor}</span>
                </span>
                {needsSetup && <TriangleAlert className="w-3 h-3 shrink-0 text-status-warning" />}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

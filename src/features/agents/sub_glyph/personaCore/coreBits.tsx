/** coreBits — shared primitives for the persona-core configurator variants.
 *
 *  Carried over from the retired Foundry: the lucide icon resolver + the
 *  DialMeter risk/speed bar. Plus the interactive knobs the modal variants
 *  share — a labeled-pole polarity slider, the model-tier segment, and a
 *  compact memory-strategy picker. Preset rendering (archetype cards / chips /
 *  plotted points) is deliberately NOT here — each variant owns that, since the
 *  preset presentation is the whole point of the directional difference.
 */
import {
  Activity, BookOpenCheck, Brain, ConciergeBell, LibraryBig, LineChart,
  NotebookPen, Palette, Radar, Rocket, ShieldCheck, Sparkles, Target, Users,
  Workflow, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { MODEL_TIERS, type ModelTier, type PersonaCore } from "./usePersonaCore";
import type { MemoryStrategy } from "@/api/archetypes";

const CORE_ICONS: Record<string, LucideIcon> = {
  ShieldCheck, LineChart, Radar, Workflow, Activity, LibraryBig, Palette,
  Rocket, ConciergeBell, Target, Brain, Users, BookOpenCheck, NotebookPen,
};

export function coreIcon(name: string): LucideIcon {
  return CORE_ICONS[name] ?? Sparkles;
}

export const ACCENT = "#60A5FA";

/** Read-only risk/speed bar (also used in the badge preview). */
export function DialMeter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between typo-label uppercase tracking-wider text-foreground">
        <span>{label}</span>
        <span className="font-mono">{Math.round(value * 100)}</span>
      </div>
      <div className="h-1 rounded-full bg-secondary/80 mt-0.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

/** A 0…1 slider with named poles (e.g. Cautious ↔ Bold). Keyboard-accessible
 *  via the underlying range input; the track is styled over it. */
export function PolaritySlider({
  label, lowLabel, highLabel, value, color, onChange,
}: {
  label: string; lowLabel: string; highLabel: string; value: number; color: string;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="typo-label uppercase tracking-wider text-foreground">{label}</span>
        <span className="typo-caption font-mono" style={{ color }}>{pct}</span>
      </div>
      <div className="relative h-6 flex items-center">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-secondary/80 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-background shadow -translate-x-1/2 pointer-events-none"
          style={{ left: `${pct}%`, background: color }}
        />
        <input
          type="range" min={0} max={100} value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
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
                className={`flex-1 px-2 py-1.5 rounded-input typo-caption transition-colors cursor-pointer ${active ? "text-foreground" : "text-foreground/70 hover:text-foreground"}`}
                style={active ? { background: colorWithAlpha(color, 0.22), boxShadow: `inset 0 0 0 1px ${colorWithAlpha(color, 0.5)}` } : undefined}
                aria-pressed={active}
              >
                {tier.label}
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

/** The four-knob refinement block shared by the Atelier + Console variants. */
export function KnobStack({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-4">
      <PolaritySlider label="Risk" lowLabel="Cautious" highLabel="Bold" value={core.state.risk} color="#fb7185" onChange={core.setRisk} />
      <PolaritySlider label="Speed" lowLabel="Thorough" highLabel="Fast" value={core.state.speed} color="#fbbf24" onChange={core.setSpeed} />
      <ModelSegment value={core.state.model} color={ACCENT} onChange={core.setModel} />
      <MemoryPicker strategies={core.memoryStrategies} value={core.state.memoryId} color="#c084fc" onChange={core.setMemory} />
    </div>
  );
}

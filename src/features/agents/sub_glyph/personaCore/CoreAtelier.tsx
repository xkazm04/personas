/** CoreAtelier — preset-first variant.
 *
 *  Mental model: an atelier of ready-made temperaments. The archetype gallery is
 *  the hero; you pick a mentality, then the four knobs appear pre-filled and you
 *  refine. Preset drives, manual polishes.
 */
import { Check } from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { Archetype } from "@/api/archetypes";
import { coreIcon, DialMeter, KnobStack } from "./coreBits";
import { archetypeStance, type PersonaCore } from "./usePersonaCore";

export function CoreAtelier({ core }: { core: PersonaCore }) {
  return (
    <div className="flex gap-5 min-h-0">
      {/* Gallery */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto scrollbar-thin pr-1 max-h-[58vh]">
        <span className="typo-label uppercase tracking-wider text-foreground">Choose a mentality</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {core.archetypes.map((a) => (
            <PresetCard key={a.id} a={a} active={core.state.archetypeId === a.id} onSelect={() => core.applyPreset(a)} />
          ))}
        </div>
      </div>

      {/* Refine */}
      <div className="w-[300px] shrink-0 flex flex-col gap-3 pl-5 border-l border-card-border/50">
        <div className="flex flex-col gap-0.5">
          <span className="typo-label uppercase tracking-wider text-foreground">Refine</span>
          <span className="typo-caption">
            {core.preset ? `Based on ${core.preset.name} — tune to taste` : "Pick a mentality, or set the knobs directly"}
          </span>
        </div>
        <KnobStack core={core} />
      </div>
    </div>
  );
}

function PresetCard({ a, active, onSelect }: { a: Archetype; active: boolean; onSelect: () => void }) {
  const Icon = coreIcon(a.icon);
  const stance = archetypeStance(a);
  const risk = readCore(a, "riskTolerance");
  const speed = readCore(a, "speedVsQuality");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex flex-col gap-2 p-3 rounded-card border text-left transition-colors cursor-pointer ${active ? "shadow-elevation-2" : "border-card-border hover:border-foreground/25"}`}
      style={active ? { borderColor: colorWithAlpha(a.color, 0.55), background: colorWithAlpha(a.color, 0.07) } : undefined}
      aria-pressed={active}
    >
      {active && (
        <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: a.color }}>
          <Check className="w-2.5 h-2.5 text-background" />
        </span>
      )}
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-input flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(a.color, 0.14), border: `1px solid ${colorWithAlpha(a.color, 0.4)}` }}>
          <Icon className="w-4 h-4" style={{ color: a.color }} />
        </span>
        <span className="flex flex-col min-w-0">
          <span className="typo-body font-medium text-foreground truncate">{a.name}</span>
          <span className="typo-caption truncate" style={{ color: a.color }}>{a.tagline}</span>
        </span>
      </div>
      {stance && <span className="typo-caption italic line-clamp-2">“{stance}”</span>}
      <div className="flex gap-3 pt-0.5">
        <DialMeter label="Risk" value={risk} color="#fb7185" />
        <DialMeter label="Speed" value={speed} color="#fbbf24" />
      </div>
    </button>
  );
}

function readCore(a: Archetype, key: string): number {
  const core = (a.persona as { core?: Record<string, unknown> } | undefined)?.core;
  const v = core?.[key];
  return typeof v === "number" ? v : 0.5;
}

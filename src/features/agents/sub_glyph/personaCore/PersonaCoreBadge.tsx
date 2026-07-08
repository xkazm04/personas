/** PersonaCoreBadge — the affordance under the intent that replaces the old
 *  "What" leaf. The intent textarea already IS the "what" (the mandatory
 *  purpose), so this slot instead carries the persona's TEMPERAMENT: a compact
 *  read of the chosen mentality + Risk/Speed/Model/Memory, opening the
 *  configurator on click. View-only while a build is in flight.
 */
import { Atom, ChevronRight } from "lucide-react";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { coreIcon } from "./coreBits";
import { MODEL_TIERS, type PersonaCore } from "./usePersonaCore";

const ACCENT = "#60A5FA";

export function PersonaCoreBadge({ core, onOpen, locked = false }: { core: PersonaCore; onOpen: () => void; locked?: boolean }) {
  const { configured, preset, memory, state } = core;
  const PresetIcon = preset ? coreIcon(preset.icon) : Atom;
  const accent = preset?.color ?? ACCENT;
  const modelLabel = MODEL_TIERS.find((m) => m.id === state.model)?.label ?? "Balanced";

  return (
    <button
      type="button"
      onClick={locked ? undefined : onOpen}
      disabled={locked}
      data-testid="persona-core-badge"
      className={`group inline-flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-interactive border transition-colors w-full sm:w-auto ${locked ? "cursor-default" : "cursor-pointer hover:border-foreground/30"}`}
      style={{
        borderColor: configured ? colorWithAlpha(accent, 0.5) : "rgba(255,255,255,0.14)",
        background: configured ? colorWithAlpha(accent, 0.1) : "rgba(255,255,255,0.03)",
      }}
    >
      <span className="w-6 h-6 rounded-input flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(accent, configured ? 0.2 : 0.08) }}>
        <PresetIcon className="w-3.5 h-3.5" style={{ color: configured ? accent : undefined }} />
      </span>
      <span className="flex flex-col items-start leading-tight min-w-0">
        <span className="typo-caption text-foreground">
          {configured ? (preset ? preset.name : "Custom core") : "Persona core"}
        </span>
        <span className="typo-caption truncate max-w-[240px]">
          {configured
            ? `${riskWord(state.risk)} · ${speedWord(state.speed)} · ${modelLabel}${memory ? ` · ${memory.name}` : ""}`
            : "Set its temperament — mentality, risk, speed, model, memory"}
        </span>
      </span>
      {!locked && <ChevronRight className="w-3.5 h-3.5 shrink-0 ml-auto opacity-50 group-hover:opacity-90 transition-opacity" />}
    </button>
  );
}

function riskWord(v: number): string {
  return v < 0.34 ? "Cautious" : v > 0.66 ? "Bold" : "Balanced";
}
function speedWord(v: number): string {
  return v < 0.34 ? "Thorough" : v > 0.66 ? "Fast" : "Steady";
}

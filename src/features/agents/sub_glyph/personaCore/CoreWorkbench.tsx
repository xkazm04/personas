/** CoreWorkbench — the baseline layout: a wide 3-column workbench —
 *  Character (traits) · Configuration (disposition + conflict + model + effort) ·
 *  Mentality (archetype snapshots). Memory is intentionally absent: the build
 *  surface has a dedicated memory dimension that owns it. Everything visible at
 *  once, text-forward — the reference the visual variants react against.
 */
import { SectionHeader, DispositionBlock, EngineBlock, SnapshotColumn } from "./coreSections";
import { TraitPalette } from "./TraitPalette";
import { ACCENT } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

export function CoreWorkbench({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh] overflow-y-auto scrollbar-thin pr-1">
      {/* Character */}
      <div className="flex-[1.2] min-w-0 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <SectionHeader>Character</SectionHeader>
          {core.state.traits.length > 0 && <span className="typo-caption" style={{ color: ACCENT }}>{core.state.traits.length} traits</span>}
        </div>
        <TraitPalette core={core} />
      </div>

      {/* Configuration */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 lg:pl-6 lg:border-l border-card-border/50">
        <SectionHeader>Configuration</SectionHeader>
        <DispositionBlock core={core} />
        <EngineBlock core={core} />
      </div>

      {/* Mentality */}
      <div className="w-full lg:w-[220px] shrink-0 flex flex-col gap-3 lg:pl-6 lg:border-l border-card-border/50">
        <SectionHeader>Mentality</SectionHeader>
        <SnapshotColumn core={core} />
      </div>
    </div>
  );
}

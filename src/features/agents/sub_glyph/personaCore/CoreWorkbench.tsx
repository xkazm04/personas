/** CoreWorkbench — the baseline layout: a wide 3-column workbench with the
 *  snapshot row across the top, then Character (traits) · Configuration
 *  (disposition + conflict + model + effort) · Memory, each in its own column
 *  with a dominant column header. Everything visible at once; no scrolling
 *  between concerns.
 */
import { SectionHeader, SnapshotRow, DispositionBlock, EngineBlock } from "./coreSections";
import { TraitPalette } from "./TraitPalette";
import { MemorySection } from "./MemorySection";
import { ACCENT } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

export function CoreWorkbench({ core }: { core: PersonaCore }) {
  return (
    <div className="flex flex-col gap-4 max-h-[64vh] overflow-y-auto scrollbar-thin pr-1">
      <SnapshotRow core={core} />
      <div className="flex flex-col lg:flex-row gap-6">
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

        {/* Memory */}
        <div className="w-full lg:w-[300px] shrink-0 flex flex-col gap-3 lg:pl-6 lg:border-l border-card-border/50">
          <SectionHeader>Memory</SectionHeader>
          <MemorySection core={core} />
        </div>
      </div>
    </div>
  );
}

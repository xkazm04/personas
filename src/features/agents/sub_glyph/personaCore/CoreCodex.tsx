/** CoreCodex — visualization-forward take on the 3-column skeleton. The mental
 *  model is a well-ordered SPEC SHEET: every trait, conflict style, and model is
 *  an icon in an aligned grid, grouped by axis with a colour rail, so the eye
 *  lands where it expects and you scan symbols instead of reading rows of text.
 *  Character (icon grid) · Configuration (icon tiles + effort meter) · Mentality.
 */
import { SectionHeader, FieldLabel, SnapshotColumn } from "./coreSections";
import { AxisTraitGrid } from "./TraitGrid";
import { ConflictTiles, ModelTiles, EffortMeter } from "./coreVisuals";
import { PolaritySlider, ACCENT } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

export function CoreCodex({ core }: { core: PersonaCore }) {
  const { state } = core;
  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh] overflow-y-auto scrollbar-thin pr-1">
      {/* Character — ordered icon grid */}
      <div className="flex-[1.3] min-w-0 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <SectionHeader>Character</SectionHeader>
          {state.traits.length > 0 && <span className="typo-caption" style={{ color: ACCENT }}>{state.traits.length} traits</span>}
        </div>
        <AxisTraitGrid core={core} />
      </div>

      {/* Configuration — icon tiles + meter */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 lg:pl-6 lg:border-l border-card-border/50">
        <SectionHeader>Configuration</SectionHeader>
        <div className="rounded-card border border-card-border bg-secondary/20 p-3">
          <PolaritySlider label="Disposition" lowLabel="Cautious" highLabel="Bold" value={state.disposition} color="#fb7185" onChange={core.setDisposition} />
        </div>
        <div className="flex flex-col gap-2"><FieldLabel>In disagreement</FieldLabel><ConflictTiles core={core} /></div>
        <div className="flex flex-col gap-2"><FieldLabel>Model</FieldLabel><ModelTiles core={core} /></div>
        <div className="flex flex-col gap-2"><FieldLabel>Reasoning effort</FieldLabel><EffortMeter core={core} /></div>
      </div>

      {/* Mentality */}
      <div className="w-full lg:w-[210px] shrink-0 flex flex-col gap-3 lg:pl-6 lg:border-l border-card-border/50">
        <SectionHeader>Mentality</SectionHeader>
        <SnapshotColumn core={core} />
      </div>
    </div>
  );
}

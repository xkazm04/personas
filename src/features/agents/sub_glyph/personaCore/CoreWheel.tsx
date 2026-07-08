/** CoreWheel — visualization-forward take where a radial SIGIL is the star. The
 *  centre column renders the live CharacterWheel (axis-glow + disposition tint +
 *  conflict glyph) so the persona's shape reads at a glance; traits are picked as
 *  icon nodes on the left (the wheel lights up in response), and the compact
 *  icon controls below the wheel set disposition / conflict / model / effort.
 *  Character (nodes) · Sigil (wheel + controls) · Mentality.
 */
import { SectionHeader, FieldLabel, SnapshotColumn, dispositionWord } from "./coreSections";
import { TraitNodes } from "./TraitGrid";
import { CharacterWheel } from "./CharacterWheel";
import { ConflictTiles, ModelTiles, EffortMeter } from "./coreVisuals";
import { PolaritySlider, ACCENT } from "./coreBits";
import type { PersonaCore } from "./usePersonaCore";

export function CoreWheel({ core }: { core: PersonaCore }) {
  const { state } = core;
  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh] overflow-y-auto scrollbar-thin pr-1">
      {/* Character — icon nodes */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <SectionHeader>Character</SectionHeader>
          {state.traits.length > 0 && <span className="typo-caption" style={{ color: ACCENT }}>{state.traits.length} traits</span>}
        </div>
        <TraitNodes core={core} />
      </div>

      {/* Sigil — the wheel + compact controls */}
      <div className="w-full lg:w-[300px] shrink-0 flex flex-col gap-3 lg:px-6 lg:border-x border-card-border/50">
        <SectionHeader>Sigil</SectionHeader>
        <CharacterWheel core={core} />
        <div className="rounded-card border border-card-border bg-secondary/20 p-3">
          <PolaritySlider label={`Disposition · ${dispositionWord(state.disposition)}`} lowLabel="Cautious" highLabel="Bold" value={state.disposition} color="#fb7185" onChange={core.setDisposition} />
        </div>
        <div className="flex flex-col gap-2"><FieldLabel>In disagreement</FieldLabel><ConflictTiles core={core} /></div>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-col gap-2"><FieldLabel>Model</FieldLabel><ModelTiles core={core} /></div>
          <div className="flex flex-col gap-2"><FieldLabel>Reasoning effort</FieldLabel><EffortMeter core={core} /></div>
        </div>
      </div>

      {/* Mentality */}
      <div className="w-full lg:w-[190px] shrink-0 flex flex-col gap-3">
        <SectionHeader>Mentality</SectionHeader>
        <SnapshotColumn core={core} />
      </div>
    </div>
  );
}

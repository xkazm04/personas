/** PersonaCoreCodex — the configurator body (the "Codex" layout that won the
 *  /prototype round). A well-ordered, icon-forward 3-column spec sheet: every
 *  trait, conflict style, and model is a symbol in an aligned grid, so the eye
 *  lands where it expects and you scan rather than read.
 *  Character (icon grid) · Configuration (icon tiles + effort meter) · Mentality.
 */
import { useTranslation } from "@/i18n/useTranslation";
import { SectionHeader, FieldLabel } from "./SectionLabels";
import { SnapshotColumn } from "./SnapshotColumn";
import { AxisTraitGrid } from "./TraitGrid";
import { ConflictTiles, ModelTiles, EffortMeter } from "./ConfigTiles";
import { PolaritySlider } from "./PolaritySlider";
import { ACCENT } from "./catalog";
import type { PersonaCore } from "./types";

export function PersonaCoreCodex({ core }: { core: PersonaCore }) {
  const { t, tx } = useTranslation();
  const { state } = core;
  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh] overflow-y-auto scrollbar-thin pr-1">
      {/* Character — ordered icon grid (single column) */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <SectionHeader>{t.agents.core_col_character}</SectionHeader>
          {state.traits.length > 0 && (
            <span className="typo-caption" style={{ color: ACCENT }}>
              {state.traits.length === 1
                ? t.agents.core_traits_one
                : tx(t.agents.core_traits_other, { count: state.traits.length })}
            </span>
          )}
        </div>
        <AxisTraitGrid core={core} />
      </div>

      {/* Configuration — icon tiles + meter */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 lg:pl-6 lg:border-l border-card-border/50">
        <SectionHeader>{t.agents.core_col_configuration}</SectionHeader>
        <div className="rounded-card border border-card-border bg-secondary/20 p-3">
          <PolaritySlider
            label={t.agents.core_disposition}
            lowLabel={t.agents.core_disposition_low}
            highLabel={t.agents.core_disposition_high}
            value={state.disposition}
            color="#fb7185"
            onChange={core.setDisposition}
          />
        </div>
        <div className="flex flex-col gap-2"><FieldLabel>{t.agents.core_conflict_label}</FieldLabel><ConflictTiles core={core} /></div>
        <div className="flex flex-col gap-2"><FieldLabel>{t.agents.core_model_label}</FieldLabel><ModelTiles core={core} /></div>
        <div className="flex flex-col gap-2"><FieldLabel>{t.agents.core_effort_label}</FieldLabel><EffortMeter core={core} /></div>
      </div>

      {/* Mentality — expanded to an equal column for the rich persona cards */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 lg:pl-6 lg:border-l border-card-border/50">
        <SectionHeader>{t.agents.core_col_mentality}</SectionHeader>
        <SnapshotColumn core={core} />
      </div>
    </div>
  );
}

/** PersonaCoreCodex — the configurator body (the "Codex" layout that won the
 *  /prototype round). A well-ordered, icon-forward 3-column spec sheet: every
 *  trait, conflict style, and model is a symbol in an aligned grid, so the eye
 *  lands where it expects and you scan rather than read.
 *  Mentality (one-click presets) · Character (icon grid) · Configuration
 *  (icon tiles + effort meter) — presets lead, hand-assembly follows.
 */
import { Undo2 } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { SectionHeader, FieldLabel } from "./SectionLabels";
import { SnapshotColumn } from "./SnapshotColumn";
import { AxisTraitGrid } from "./TraitGrid";
import { ConflictTiles, ModelTiles, EffortMeter } from "./ConfigTiles";
import { PolaritySlider } from "./PolaritySlider";
import { ACCENT, DISPOSITION_ACCENT } from "./catalog";
import type { PersonaCore } from "./types";

export function PersonaCoreCodex({ core }: { core: PersonaCore }) {
  const { t, tx } = useTranslation();
  const { state } = core;
  // One scroller below lg, where the columns stack and scrolling them together
  // is the only sensible thing. Side by side, each column owns its own scroll:
  // browsing nine mentality cards used to push the trait grid off-screen
  // because all three shared a single 64vh scroller. `min-h-0` on each column
  // is load-bearing -- a flex child defaults to min-height:auto and would
  // refuse to shrink, so it would never overflow and never scroll.
  return (
    <div className="flex flex-col lg:flex-row gap-6 max-h-[64vh] overflow-y-auto lg:overflow-hidden scrollbar-thin pr-1">
      {/* Mentality FIRST — a card seeds disposition, conflict style and five
          dominant traits in one click (applyPreset). It used to sit third, so
          the reading order taught the modal backwards: a first-timer worked
          through 20 trait toggles and three tile groups by hand and only then
          met the shortcut that would have done it. Expanded to an equal column
          for the rich persona cards. */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0 lg:overflow-y-auto scrollbar-thin lg:pr-2">
        <SectionHeader>{t.agents.core_col_mentality}</SectionHeader>
        <SnapshotColumn core={core} />
      </div>

      {/* Character — ordered icon grid (single column) */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 lg:pl-6 lg:border-l border-card-border/50 min-h-0 lg:overflow-y-auto scrollbar-thin lg:pr-2">
        <div className="flex items-baseline justify-between">
          <SectionHeader>{t.agents.core_col_character}</SectionHeader>
          <span className="flex items-center gap-2">
            {/* Picking a mentality REPLACES the whole trait set. The cards are
                one click away in the same modal, so a curious click used to
                cost a minute of deliberate work with no way back. The offer
                appears only when something was actually discarded, and
                withdraws itself the moment the user edits the new set. */}
            {core.discardedTraits && (
              <button
                type="button"
                onClick={core.restoreTraits}
                data-testid="core-restore-traits"
                className="inline-flex items-center gap-1 typo-caption text-foreground hover:text-foreground/80 cursor-pointer"
              >
                <Undo2 className="w-3 h-3" /> {t.agents.core_traits_restore}
              </button>
            )}
            {state.traits.length > 0 && (
              <span className="typo-caption" style={{ color: ACCENT }}>
                {state.traits.length === 1
                  ? t.agents.core_traits_one
                  : tx(t.agents.core_traits_other, { count: state.traits.length })}
              </span>
            )}
          </span>
        </div>
        <AxisTraitGrid core={core} />
      </div>

      {/* Configuration — icon tiles + meter */}
      <div className="flex-1 min-w-0 flex flex-col gap-4 lg:pl-6 lg:border-l border-card-border/50 min-h-0 lg:overflow-y-auto scrollbar-thin lg:pr-2">
        <SectionHeader>{t.agents.core_col_configuration}</SectionHeader>
        <div className="rounded-card border border-card-border bg-secondary/20 p-3">
          <PolaritySlider
            label={t.agents.core_disposition}
            lowLabel={t.agents.core_disposition_low}
            highLabel={t.agents.core_disposition_high}
            value={state.disposition}
            color={DISPOSITION_ACCENT}
            onChange={core.setDisposition}
          />
        </div>
        <div className="flex flex-col gap-2"><FieldLabel>{t.agents.core_conflict_label}</FieldLabel><ConflictTiles core={core} /></div>
        <div className="flex flex-col gap-2"><FieldLabel>{t.agents.core_model_label}</FieldLabel><ModelTiles core={core} /></div>
        <div className="flex flex-col gap-2"><FieldLabel>{t.agents.core_effort_label}</FieldLabel><EffortMeter core={core} /></div>
      </div>
    </div>
  );
}

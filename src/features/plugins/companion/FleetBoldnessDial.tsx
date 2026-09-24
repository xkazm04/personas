// Fleet-orchestration boldness dial (Phase 2) — lives inside the autonomy
// options popup (`AthenaAutonomyOption`): how aggressively Athena auto-fires
// input into a live CLI vs. surfacing an orb consult, combined with her
// per-decision `decision_class` + `confidence`. Cautious = high-confidence only
// (both classes); Balanced = an obvious next-step (`drive_forward`) at
// high|medium, a real `choice` high-only; Bold = both at high|medium. Mirrored
// server-side via `companion_set_fleet_boldness`; the autoapprove gate
// (`fleet_send_input_auto_fires`) reads the persisted row.
import { useCallback, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import {
  companionGetFleetBoldness,
  companionSetFleetBoldness,
  type FleetBoldnessLevel,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { ChoiceRow } from './AutonomyChoiceRow';

const LEVELS: readonly FleetBoldnessLevel[] = ['cautious', 'balanced', 'bold'] as const;

export interface FleetBoldnessState {
  level: FleetBoldnessLevel;
  choose: (next: FleetBoldnessLevel) => void;
  labelFor: (level: FleetBoldnessLevel) => string;
}

/** The persisted boldness level. Hydrates from the server when `enabled` turns on. */
export function useFleetBoldness(enabled = true): FleetBoldnessState {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const level = useSystemStore((s) => s.companionFleetBoldness);
  const setLevel = useSystemStore((s) => s.setCompanionFleetBoldness);

  // The gate reads the persisted row, so the UI must reflect it rather than
  // the store's default.
  useEffect(() => {
    if (!enabled) return;
    companionGetFleetBoldness()
      .then(setLevel)
      .catch(silentCatch('companion_get_fleet_boldness'));
  }, [enabled, setLevel]);

  const choose = useCallback(
    (next: FleetBoldnessLevel) => {
      setLevel(next); // optimistic — instant UI feedback
      companionSetFleetBoldness(next).catch(silentCatch('companion_set_fleet_boldness'));
    },
    [setLevel],
  );

  const labelFor = useCallback(
    (l: FleetBoldnessLevel) =>
      l === 'cautious' ? c.boldness_cautious : l === 'balanced' ? c.boldness_balanced : c.boldness_bold,
    [c],
  );

  return { level, choose, labelFor };
}

export function FleetBoldnessDial({ boldness, disabled = false }: { boldness: FleetBoldnessState; disabled?: boolean }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  return (
    <div className="flex flex-col gap-2" data-testid="companion-fleet-boldness">
      <p className="typo-caption text-foreground">{c.boldness_hint}</p>
      <ChoiceRow
        label={c.boldness_label}
        choices={LEVELS.map((l) => ({ id: l, label: boldness.labelFor(l), testId: `fleet-boldness-${l}` }))}
        value={boldness.level}
        onChoose={boldness.choose}
        disabled={disabled}
      />
    </div>
  );
}

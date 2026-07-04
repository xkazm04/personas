// Fleet-orchestration boldness dial (Phase 2) — visible while autonomous mode
// is ON: how aggressively Athena auto-fires input into a live CLI vs. surfacing
// an orb consult, combined with her per-decision `decision_class` + `confidence`.
// Cautious = high-confidence only (both classes); Balanced = an obvious next-step
// (`drive_forward`) at high|medium, a real `choice` high-only; Bold = both at
// high|medium. Mirrored server-side via `companion_set_fleet_boldness`; the
// autoapprove gate (`fleet_send_input_auto_fires`) reads the persisted row.
import { useEffect } from 'react';
import { Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import {
  companionGetFleetBoldness,
  companionSetFleetBoldness,
  type FleetBoldnessLevel,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';

const LEVELS: readonly FleetBoldnessLevel[] = ['cautious', 'balanced', 'bold'] as const;

export function FleetBoldnessDial() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const level = useSystemStore((s) => s.companionFleetBoldness);
  const setLevel = useSystemStore((s) => s.setCompanionFleetBoldness);

  // Hydrate from the persisted server value on mount — the gate reads that row,
  // so the UI must reflect it rather than the store's default.
  useEffect(() => {
    companionGetFleetBoldness()
      .then(setLevel)
      .catch(silentCatch('companion_get_fleet_boldness'));
  }, [setLevel]);

  const choose = (next: FleetBoldnessLevel) => {
    setLevel(next); // optimistic — instant UI feedback
    companionSetFleetBoldness(next).catch(silentCatch('companion_set_fleet_boldness'));
  };

  const labelFor = (l: FleetBoldnessLevel) =>
    l === 'cautious'
      ? c.boldness_cautious
      : l === 'balanced'
        ? c.boldness_balanced
        : c.boldness_bold;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/10 bg-primary/[0.03]"
      data-testid="companion-fleet-boldness"
    >
      <Tooltip content={c.boldness_hint}>
        <span className="flex items-center gap-1 typo-caption text-foreground/80 flex-shrink-0">
          <Gauge className="w-3 h-3" aria-hidden />
          {c.boldness_label}
        </span>
      </Tooltip>
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={c.boldness_label}>
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={level === l}
            onClick={() => choose(l)}
            className={`px-1.5 py-0.5 rounded-interactive typo-caption transition-colors focus-ring ${
              level === l ? 'bg-primary/15 text-primary' : 'text-foreground/70 hover:bg-secondary/40'
            }`}
            data-testid={`fleet-boldness-${l}`}
          >
            {labelFor(l)}
          </button>
        ))}
      </div>
    </div>
  );
}

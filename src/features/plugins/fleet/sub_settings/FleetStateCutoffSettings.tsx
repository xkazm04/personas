import { Clock } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { stateText } from '../sub_grid/fleetStateTone';
import { FleetSettingsCard } from './FleetSettingsCard';
import { FleetMinutesField } from './FleetMinutesField';

/**
 * Tunable staleness cutoffs — how long flat logs may sit before a session
 * flips `Stale`, and how long total PTY silence may last before a `Running`
 * session is flagged frozen. Same persisted-slice + push-to-Rust plumbing as
 * the auto-hibernate card; clamped both here (1–60 min) and server-side.
 * Power users running slow models or big fleets calibrate state accuracy
 * here instead of via the PERSONAS_FLEET_* env knobs.
 */
export function FleetStateCutoffSettings() {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const staleMinutes = useSystemStore((s) => s.fleetStaleMinutes);
  const frozenMinutes = useSystemStore((s) => s.fleetFrozenMinutes);
  const setStale = useSystemStore((s) => s.fleetSetStaleMinutes);
  const setFrozen = useSystemStore((s) => s.fleetSetFrozenMinutes);

  return (
    <FleetSettingsCard
      data-testid="fleet-state-cutoff-settings"
      icon={<Clock className={`w-4 h-4 ${stateText('stale')}`} />}
      title={f.state_cutoffs_title}
      description={f.state_cutoffs_desc}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FleetMinutesField
          label={f.state_cutoffs_stale}
          unit={f.state_cutoffs_minutes_unit}
          value={staleMinutes}
          min={1}
          max={60}
          onCommit={setStale}
          testId="fleet-stale-minutes"
        />
        <FleetMinutesField
          label={f.state_cutoffs_frozen}
          unit={f.state_cutoffs_minutes_unit}
          value={frozenMinutes}
          min={1}
          max={60}
          onCommit={setFrozen}
          testId="fleet-frozen-minutes"
        />
      </div>
    </FleetSettingsCard>
  );
}

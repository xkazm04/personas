import { Clock } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

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

  const inputClass =
    'w-16 rounded-input border border-primary/10 bg-secondary/40 px-2 py-1 text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40';

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-state-cutoff-settings"
    >
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-orange-400" aria-hidden="true" />
        <p className="typo-caption font-medium text-foreground">{f.state_cutoffs_title}</p>
      </div>
      <p className="text-[14px] text-foreground leading-relaxed mb-3 opacity-80">{f.state_cutoffs_desc}</p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-[14px] text-foreground">
          {f.state_cutoffs_stale}
          <input
            type="number"
            min={1}
            max={60}
            value={staleMinutes}
            onChange={(e) => setStale(Number(e.target.value))}
            data-testid="fleet-stale-minutes"
            className={inputClass}
          />
          {f.state_cutoffs_minutes_unit}
        </label>
        <label className="flex items-center gap-2 text-[14px] text-foreground">
          {f.state_cutoffs_frozen}
          <input
            type="number"
            min={1}
            max={60}
            value={frozenMinutes}
            onChange={(e) => setFrozen(Number(e.target.value))}
            data-testid="fleet-frozen-minutes"
            className={inputClass}
          />
          {f.state_cutoffs_minutes_unit}
        </label>
      </div>
    </div>
  );
}

import { Cpu } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Live-slot scheduler control (fleet-scale Tier A). Caps how many
 * process-backed `claude` sessions run at once: overflow Idle/Stale sessions
 * are hibernated (oldest first) by the always-on Rust ticker and can be woken
 * later, so RAM/CPU tracks active work rather than tracked conversations.
 * Persisted in the fleet slice and pushed to Rust on change + on refresh —
 * the same plumbing as auto-hibernate.
 */
export function FleetLiveSlotSettings() {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const enabled = useSystemStore((s) => s.fleetLiveSlotsEnabled);
  const max = useSystemStore((s) => s.fleetMaxLiveSessions);
  const setEnabled = useSystemStore((s) => s.fleetSetLiveSlotsEnabled);
  const setMax = useSystemStore((s) => s.fleetSetMaxLiveSessions);

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-live-slot-settings"
    >
      <div className="flex items-center gap-2 mb-1">
        <Cpu className="w-4 h-4 text-sky-400" aria-hidden="true" />
        <p className="typo-caption font-medium text-foreground">{f.live_slots_title}</p>
      </div>
      <p className="text-[14px] text-foreground leading-relaxed mb-3 opacity-80">{f.live_slots_desc}</p>

      <div className="flex items-center justify-between gap-3">
        <AccessibleToggle
          checked={enabled}
          onChange={() => setEnabled(!enabled)}
          label={f.live_slots_toggle}
          data-testid="fleet-live-slots-toggle"
        />
        <label className="flex items-center gap-2 text-[14px] text-foreground">
          {f.live_slots_max_label}
          <input
            type="number"
            min={1}
            max={64}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            disabled={!enabled}
            data-testid="fleet-live-slots-max"
            className="w-16 rounded-input border border-primary/10 bg-secondary/40 px-2 py-1 text-[14px] text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          {f.live_slots_unit}
        </label>
      </div>
    </div>
  );
}

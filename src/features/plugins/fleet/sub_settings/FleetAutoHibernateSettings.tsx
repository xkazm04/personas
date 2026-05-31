import { Moon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Auto-hibernate policy control (F3 / P3.2). Toggles the always-on Rust
 * staleness ticker's auto-hibernate pass and its inactivity threshold. The
 * setting is persisted in the fleet slice and pushed to Rust on change +
 * whenever Fleet refreshes.
 */
export function FleetAutoHibernateSettings() {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const enabled = useSystemStore((s) => s.fleetAutoHibernate);
  const minutes = useSystemStore((s) => s.fleetAutoHibernateMinutes);
  const setEnabled = useSystemStore((s) => s.fleetSetAutoHibernate);
  const setMinutes = useSystemStore((s) => s.fleetSetAutoHibernateMinutes);

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-auto-hibernate-settings"
    >
      <div className="flex items-center gap-2 mb-1">
        <Moon className="w-4 h-4 text-indigo-400" aria-hidden="true" />
        <p className="typo-caption font-medium text-foreground">{f.auto_hibernate_title}</p>
      </div>
      <p className="text-[14px] text-foreground leading-relaxed mb-3 opacity-80">{f.auto_hibernate_desc}</p>

      <div className="flex items-center justify-between gap-3">
        <AccessibleToggle
          checked={enabled}
          onChange={() => setEnabled(!enabled)}
          label={f.auto_hibernate_toggle}
          data-testid="fleet-auto-hibernate-toggle"
        />
        <label className="flex items-center gap-2 text-[14px] text-foreground">
          {f.auto_hibernate_after}
          <input
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            disabled={!enabled}
            data-testid="fleet-auto-hibernate-minutes"
            className="w-16 rounded-input border border-primary/10 bg-secondary/40 px-2 py-1 text-[14px] text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          {f.auto_hibernate_minutes_unit}
        </label>
      </div>
    </div>
  );
}

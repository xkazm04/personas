import { Moon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { stateText } from '../sub_grid/fleetStateTone';
import { FleetSettingsCard } from './FleetSettingsCard';
import { FleetMinutesField } from './FleetMinutesField';

/**
 * Auto-hibernate policy control (F3 / P3.2). Toggles the always-on Rust
 * staleness ticker's auto-hibernate pass and its inactivity threshold. The
 * setting is persisted in the fleet slice and pushed to Rust on change +
 * whenever Fleet refreshes. The minutes field commits on blur, Enter or a
 * released stepper, so typing "45" pushes the policy once, not per keystroke.
 */
export function FleetAutoHibernateSettings() {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const enabled = useSystemStore((s) => s.fleetAutoHibernate);
  const minutes = useSystemStore((s) => s.fleetAutoHibernateMinutes);
  const setEnabled = useSystemStore((s) => s.fleetSetAutoHibernate);
  const setMinutes = useSystemStore((s) => s.fleetSetAutoHibernateMinutes);

  return (
    <FleetSettingsCard
      data-testid="fleet-auto-hibernate-settings"
      icon={<Moon className={`w-4 h-4 ${stateText('hibernated')}`} />}
      title={f.auto_hibernate_title}
      description={f.auto_hibernate_desc}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <AccessibleToggle
          checked={enabled}
          onChange={() => setEnabled(!enabled)}
          label={f.auto_hibernate_toggle}
          data-testid="fleet-auto-hibernate-toggle"
        />
        <FleetMinutesField
          label={f.auto_hibernate_after}
          unit={f.auto_hibernate_minutes_unit}
          value={minutes}
          min={1}
          max={1440}
          disabled={!enabled}
          onCommit={setMinutes}
          testId="fleet-auto-hibernate-minutes"
        />
      </div>
    </FleetSettingsCard>
  );
}

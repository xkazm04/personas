import { Bell, BellOff, Keyboard } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetHooksPill } from '../FleetHooksPill';

/** The Sessions header's right end: the awaiting-input alert toggle, the shortcuts sheet, the hooks pill. */
export function FleetGridHeaderActions({ onShowHotkeys }: { onShowHotkeys: () => void }) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const notifyAwaiting = useSystemStore((s) => s.fleetNotifyAwaiting);
  const setNotifyAwaiting = useSystemStore((s) => s.fleetSetNotifyAwaiting);
  const notifyLabel = notifyAwaiting ? f.notify_disable : f.notify_enable;

  return (
    <div className="flex items-center gap-1">
      <Tooltip content={notifyLabel}>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="fleet-notify-toggle"
          aria-pressed={notifyAwaiting}
          aria-label={notifyLabel}
          onClick={() => setNotifyAwaiting(!notifyAwaiting)}
        >
          {notifyAwaiting ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
        </Button>
      </Tooltip>
      <Tooltip content={f.hotkeys_title}>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="fleet-hotkeys-open"
          aria-label={f.hotkeys_title}
          onClick={onShowHotkeys}
        >
          <Keyboard className="w-3.5 h-3.5" />
        </Button>
      </Tooltip>
      <FleetHooksPill />
    </div>
  );
}

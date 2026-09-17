import { useCallback } from 'react';
import { Laptop } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

// Devices icon -- SHIPS IN PRODUCTION.
//
// The Network icon is dev-only because exposure/bundles/raw peers are
// diagnostics. Pairing is not: a user with two machines needs to reach it in a
// release build, so this is its own always-present door to Settings -> Devices.

export default function DevicesFooterIcon() {
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const { t: tDevices } = useTranslation();

  const handleClick = useCallback(() => {
    setSidebarSection('settings');
    setSettingsTab('devices');
  }, [setSidebarSection, setSettingsTab]);

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="footer-devices"
      className="w-7 h-7 rounded-card flex items-center justify-center transition-colors text-foreground hover:bg-secondary/50"
      title={tDevices.chrome.paired_devices}
      aria-label={tDevices.chrome.paired_devices}
    >
      <Laptop className="w-5 h-5" />
    </button>
  );
}

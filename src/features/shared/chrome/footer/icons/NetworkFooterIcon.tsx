import { useCallback } from 'react';
import { Share2 } from 'lucide-react';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

// Network icon -- golden styling when hidden behind dev mode.

export default function NetworkFooterIcon() {
  const { isBuilder: isDevMode } = useTier();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const { t: tNet } = useTranslation();

  const handleClick = useCallback(() => {
    setSidebarSection('settings');
    setSettingsTab('network');
  }, [setSidebarSection, setSettingsTab]);

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="footer-network"
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        isDevMode
          ? 'text-amber-400/80 bg-amber-500/8 ring-1 ring-amber-500/30 hover:bg-amber-500/15'
          : 'text-amber-400/60 bg-amber-500/5 ring-1 ring-amber-500/20 hover:bg-amber-500/10'
      }`}
      title={tNet.chrome.network_settings}
      aria-label={tNet.chrome.network_settings}
    >
      <Share2 className="w-5 h-5" />
    </button>
  );
}

import { useEffect } from 'react';
import { Bot } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from './companionStore';
import { companionInit } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Athena's footer trigger. Lives in DesktopFooter's right cluster.
 *
 * Also responsible for firing the one-time `companion_init` IPC on first
 * mount (idempotent backend-side). Putting init here means it runs as soon
 * as the footer renders, not deferred to the first panel open.
 */
export default function CompanionFooterIcon() {
  const { t } = useTranslation();
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);
  const initialized = useCompanionStore((s) => s.initialized);
  const setInitialized = useCompanionStore((s) => s.setInitialized);
  const setBrainPath = useCompanionStore((s) => s.setBrainPath);
  const setInitError = useCompanionStore((s) => s.setInitError);

  useEffect(() => {
    if (initialized) return;
    void companionInit()
      .then((path) => {
        setBrainPath(path);
        setInitialized(true);
      })
      .catch((err: unknown) => {
        setInitError(err instanceof Error ? err.message : String(err));
        silentCatch('companion_init')(err);
      });
  }, [initialized, setBrainPath, setInitialized, setInitError]);

  const isOpen = state === 'open';

  return (
    <button
      onClick={() => setState(isOpen ? 'collapsed' : 'open')}
      data-testid="footer-companion"
      className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition-colors focus-ring ${
        isOpen
          ? 'bg-primary/15 text-primary'
          : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
      }`}
      title={t.plugins.companion.open_label}
      aria-label={t.plugins.companion.open_label}
      aria-pressed={isOpen}
    >
      <Bot className="w-4 h-4" />
    </button>
  );
}

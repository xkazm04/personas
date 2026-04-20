import { Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Empty Console variant shell for Phase 05. The live status + inbox feed
 * will be wired from the unified inbox selector in Phase 08.
 */
export default function ConsoleVariant() {
  const { t, tx } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-8">
      <div className="w-14 h-14 rounded-3xl border simple-accent-emerald-soft simple-accent-emerald-border flex items-center justify-center">
        <Gauge className="w-6 h-6 simple-accent-emerald-text" />
      </div>
      <div className="typo-heading simple-display text-foreground">{t.simple_mode.tab_console}</div>
      <div className="typo-caption text-foreground/60 text-center max-w-sm">
        {tx(t.simple_mode.wiring_next_phase, { phase: '08' })} ·{' '}
        {t.simple_mode.wiring_console_hint}
      </div>
    </div>
  );
}

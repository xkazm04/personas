import { Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Empty Inbox variant shell for Phase 05. The full review experience
 * (approvals + unread messages + healing issues) lands in Phase 09.
 */
export default function InboxVariant() {
  const { t, tx } = useTranslation();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-foreground/60 p-8">
      <div className="w-14 h-14 rounded-3xl border border-primary/15 bg-foreground/[0.03] flex items-center justify-center">
        <Inbox className="w-6 h-6 text-foreground/50" />
      </div>
      <div className="text-sm font-medium text-foreground">{t.simple_mode.tab_inbox}</div>
      <div className="text-xs text-foreground/50 text-center max-w-sm">
        {tx(t.simple_mode.wiring_next_phase, { phase: '09' })} ·{' '}
        {t.simple_mode.wiring_inbox_hint}
      </div>
    </div>
  );
}

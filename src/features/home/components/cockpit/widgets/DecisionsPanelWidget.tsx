import { useMemo, useState } from 'react';
import { Inbox, ShieldCheck, MessageSquare, Activity, FileText } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useUnifiedInbox } from '@/features/plugins/companion/inbox/hooks/useUnifiedInbox';
import { formatRelativeTime } from '@/features/plugins/companion/inbox/utils/formatRelativeTime';
import { toneForInboxItem } from '@/features/plugins/companion/inbox/_shared/inboxTone';
import type { UnifiedInboxItem } from '@/features/plugins/companion/inbox/types';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { DecisionDrawer } from './DecisionDrawer';
import { DebtText } from '@/i18n/DebtText';


/**
 * Decisions panel — flat list of unified inbox items (approvals + messages +
 * health + outputs). Clicking a row opens a modal drawer with the full body
 * and the per-kind action buttons. The widget itself stays compact so it can
 * sit comfortably in a 6-12-column cell.
 *
 * Config:
 *   { "limit": N }
 */
export function DecisionsPanelWidget({ config, title }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 20;
  const { t } = useTranslation();
  const inbox = useUnifiedInbox();
  const [open, setOpen] = useState<UnifiedInboxItem | null>(null);

  const rows = useMemo(() => inbox.slice(0, limit), [inbox, limit]);

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground uppercase tracking-wide">
          {title ?? 'Decisions to make'}
        </div>
        <div className="typo-caption text-foreground">
          {rows.length} of {inbox.length}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground">
          <Inbox className="w-6 h-6" />
          <div className="typo-caption"><DebtText k="auto_nothing_waiting_c5cb3e55" /></div>
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {rows.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setOpen(item)}
                className="w-full flex items-center gap-2 rounded-input px-2 py-1.5 hover:bg-foreground/[0.04] transition-colors text-left"
              >
                <KindGlyph kind={item.kind} tone={toneForInboxItem(item)} />
                <div className="flex-1 min-w-0">
                  <div className="typo-caption truncate text-foreground/85">{item.title}</div>
                  <div className="typo-caption text-foreground truncate">
                    {item.personaName} · {formatRelativeTime(item.createdAt, t)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <DecisionDrawer item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function KindGlyph({
  kind,
  tone,
}: {
  kind: UnifiedInboxItem['kind'];
  tone: 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';
}) {
  const Icon =
    kind === 'approval' ? ShieldCheck
    : kind === 'message' ? MessageSquare
    : kind === 'health' ? Activity
    : FileText;
  const cls =
    tone === 'amber' ? 'text-amber-400'
    : tone === 'violet' ? 'text-violet-400'
    : tone === 'emerald' ? 'text-emerald-400'
    : tone === 'rose' ? 'text-rose-400'
    : 'text-yellow-400';
  return <Icon className={`w-3.5 h-3.5 shrink-0 ${cls}`} />;
}

import { useEffect, useState } from 'react';
import { X, ShieldCheck, MessageSquare, Activity, FileText } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useInboxActions } from '@/features/plugins/companion/inbox/hooks/useInboxActions';
import { formatRelativeTime } from '@/features/plugins/companion/inbox/utils/formatRelativeTime';
import type { UnifiedInboxItem } from '@/features/plugins/companion/inbox/types';
import { DebtText } from '@/i18n/DebtText';


/**
 * Drawer opened from DecisionsPanelWidget when the user clicks a row. Shows
 * the full body + per-kind primary/secondary/tertiary action buttons. Closes
 * automatically once the primary action resolves so the underlying list
 * filters the item out without an explicit close.
 */
export interface DecisionDrawerProps {
  item: UnifiedInboxItem;
  onClose: () => void;
}

export function DecisionDrawer({ item, onClose }: DecisionDrawerProps) {
  const { t } = useTranslation();
  const actions = useInboxActions(item);
  const [busy, setBusy] = useState<null | 'primary' | 'secondary' | 'tertiary'>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (slot: 'primary' | 'secondary' | 'tertiary') => {
    const action = actions[slot];
    if (!action || busy !== null) return;
    setBusy(slot);
    try {
      await action.run(notes.trim() || undefined);
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] flex flex-col rounded-modal border border-foreground/15 bg-background shadow-elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 border-b border-foreground/10">
          <KindBadge kind={item.kind} />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium text-foreground truncate">{item.title}</div>
            <div className="typo-caption text-foreground flex items-center gap-2 mt-0.5">
              <span className="truncate">{item.personaName}</span>
              <span>·</span>
              <span>{formatRelativeTime(item.createdAt, t)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-input text-foreground hover:text-foreground/85 hover:bg-foreground/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 typo-body text-foreground/85 whitespace-pre-wrap break-words">
          {item.body}
        </div>

        {item.kind === 'approval' && (
          <div className="px-5 pb-3">
            <label className="block">
              <span className="typo-label uppercase tracking-wider text-foreground block mb-1.5">
                <DebtText k="auto_notes_optional_4d56ca9b" />
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-input border border-foreground/10 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-foreground/30 resize-none"
              />
            </label>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 p-4 border-t border-foreground/10">
          {actions.tertiary && (
            <button
              type="button"
              onClick={() => void run('tertiary')}
              disabled={busy !== null}
              className="px-3 py-1.5 rounded-input typo-caption text-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors disabled:opacity-50"
            >
              {actionLabel(actions.tertiary.labelKey)}
            </button>
          )}
          {actions.secondary && (
            <button
              type="button"
              onClick={() => void run('secondary')}
              disabled={busy !== null}
              className="px-3 py-1.5 rounded-input typo-caption text-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors disabled:opacity-50"
            >
              {actionLabel(actions.secondary.labelKey)}
            </button>
          )}
          {actions.primary && (
            <button
              type="button"
              onClick={() => void run('primary')}
              disabled={busy !== null}
              className="px-4 py-1.5 rounded-input typo-caption font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {busy === 'primary' ? 'Working…' : actionLabel(actions.primary.labelKey)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: UnifiedInboxItem['kind'] }) {
  const map = {
    approval: { icon: <ShieldCheck className="w-3.5 h-3.5" />, cls: 'bg-amber-500/15 text-amber-300' },
    message: { icon: <MessageSquare className="w-3.5 h-3.5" />, cls: 'bg-violet-500/15 text-violet-300' },
    health: { icon: <Activity className="w-3.5 h-3.5" />, cls: 'bg-rose-500/15 text-rose-300' },
    output: { icon: <FileText className="w-3.5 h-3.5" />, cls: 'bg-emerald-500/15 text-emerald-300' },
  } as const;
  const { icon, cls } = map[kind];
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-input shrink-0 ${cls}`}>
      {icon}
    </span>
  );
}

function actionLabel(
  key:
    | 'action_approve'
    | 'action_reject'
    | 'action_defer'
    | 'action_resolve'
    | 'action_dismiss'
    | 'action_mark_read',
): string {
  switch (key) {
    case 'action_approve': return 'Approve';
    case 'action_reject': return 'Reject';
    case 'action_defer': return 'Defer';
    case 'action_resolve': return 'Resolve';
    case 'action_dismiss': return 'Dismiss';
    case 'action_mark_read': return 'Mark read';
  }
}

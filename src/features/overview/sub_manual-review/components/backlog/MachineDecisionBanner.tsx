// "Auto-accepted - veto until <time>" with a Veto action, for an item a
// machine (`machine:scan-sweep`, the store's L1 gate) decided. The veto IS the
// existing decision IPC with the opposite verdict: the backend counts a human
// verdict that differs from a machine decision as a reversal and demotes the
// item's trust slice. Renders nothing for a human-decided item, and nothing
// once the window has closed (the item is then an ordinary decided row).
import { useState } from 'react';
import { Bot, Undo2 } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { formatTimestamp } from '@/lib/utils/formatters';

import { vetoOpen, type BacklogIdea } from './backlogModel';

export function MachineDecisionBanner({
  idea,
  onAccept,
  onReject,
}: {
  idea: BacklogIdea;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
}) {
  const { t, tx, language } = useTranslation();
  const r = t.overview.review;
  const [busy, setBusy] = useState(false);
  // Read once per render: the banner is a snapshot, and the backend is the
  // authority on whether a late veto still counts (it does, as a reversal).
  if (!vetoOpen(idea, Date.now())) return null;
  const accepted = idea.status === 'accepted' || idea.status === 'delivered';
  const time = formatTimestamp(idea.vetoUntil, '-', { language });
  const veto = async () => {
    setBusy(true);
    try {
      await (accepted ? onReject(idea.id, r.backlog_veto_reason) : onAccept(idea.id));
    } catch (err) {
      // The queue already toasted why; the banner just stops spinning.
      silentCatch('MachineDecisionBanner:veto')(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-card border border-role-agent/25 bg-role-agent/10 px-3 py-2">
      <Bot className="w-4 h-4 text-role-agent shrink-0" aria-hidden />
      <span className="typo-body text-foreground flex-1 min-w-0">
        {tx(accepted ? r.backlog_auto_accepted : r.backlog_auto_rejected, { time })}
      </span>
      <Button
        variant="accent"
        tone="warning"
        size="sm"
        icon={<Undo2 className="w-3.5 h-3.5" />}
        loading={busy}
        onClick={() => void veto()}
      >
        {r.backlog_veto}
      </Button>
    </div>
  );
}

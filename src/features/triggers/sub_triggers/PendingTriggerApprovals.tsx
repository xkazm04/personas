import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Play, X } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { listPendingTriggerFires, resolvePendingTriggerFire } from '@/api/pipeline/triggers';
import type { PendingTriggerFire } from '@/lib/bindings/PendingTriggerFire';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

/**
 * Surfaces trigger fires HELD for approval (UAT P5 `approval` unattended-mode).
 * Approving republishes the held event so the run proceeds; discarding drops it.
 * Renders nothing when there are none.
 */
export function PendingTriggerApprovals() {
  const { t, tx } = useTranslation();
  const p = t.triggers.pending_approval;
  const [pending, setPending] = useState<PendingTriggerFire[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const personas = useAgentStore((s) => s.personas);
  const nameFor = (pid: string) => personas.find((x) => x.id === pid)?.name ?? pid.slice(0, 8);

  const refresh = useCallback(() => {
    listPendingTriggerFires().then(setPending).catch(silentCatch('PendingTriggerApprovals.list'));
  }, []);

  useEffect(() => {
    refresh();
    const h = window.setInterval(refresh, 20000);
    return () => window.clearInterval(h);
  }, [refresh]);

  if (pending.length === 0) return null;

  const resolve = async (id: string, approved: boolean) => {
    setBusy(id);
    try {
      await resolvePendingTriggerFire(id, approved);
      setPending((cur) => cur.filter((x) => x.id !== id));
    } catch (e) {
      toastCatch('PendingTriggerApprovals.resolve')(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="pending-trigger-approvals"
      className="mb-3 rounded-card border border-amber-500/25 bg-amber-500/5 p-3 space-y-2"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="typo-body font-medium text-amber-300">{p.title}</span>
        <span className="typo-caption text-foreground">
          {tx(pending.length === 1 ? p.subtitle_one : p.subtitle_other, { count: pending.length })}
        </span>
      </div>
      <div className="space-y-1.5">
        {pending.map((pf) => (
          <div key={pf.id} className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-background/40">
            <div className="min-w-0 flex-1">
              <div className="typo-body text-foreground truncate">{nameFor(pf.persona_id)}</div>
              <div className="typo-caption text-foreground truncate">{pf.event_type}</div>
            </div>
            <AsyncButton
              variant="secondary"
              size="sm"
              isLoading={busy === pf.id}
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() => resolve(pf.id, true)}
            >
              {p.run_now}
            </AsyncButton>
            <button
              type="button"
              disabled={busy === pf.id}
              onClick={() => resolve(pf.id, false)}
              className="px-2 py-1 rounded-card text-foreground hover:bg-secondary/40 disabled:opacity-50"
              title={p.discard}
              aria-label={p.discard}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

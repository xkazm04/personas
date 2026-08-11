import { useState } from 'react';
import { ShieldAlert, Play, X } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { resolvePendingTriggerFire } from '@/api/pipeline/triggers';
import type { PendingTriggerFire } from '@/lib/bindings/PendingTriggerFire';
import type { PersonaTrigger } from '@/lib/types/types';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { usePendingTriggerFires } from '@/features/triggers/hooks/usePendingTriggerFires';

interface PendingTriggerApprovalsProps {
  /** Scope to one agent's triggers. Omit for the workspace-wide queue. */
  personaId?: string;
}

/**
 * Surfaces trigger fires HELD for approval (the `approval` unattended-mode of
 * the destructive-action gate, UAT P5). Approving republishes the held event so
 * the run proceeds; discarding drops it. Renders nothing when there are none.
 *
 * Each row names the agent, the firing trigger and the event that arrived, plus
 * how long it has been waiting — a held fire whose age is invisible is a
 * decision the user cannot prioritise.
 */
export function PendingTriggerApprovals({ personaId }: PendingTriggerApprovalsProps) {
  const { t, tx } = useTranslation();
  const p = t.triggers.pending_approval;
  const { pending, triggerFor, forget } = usePendingTriggerFires(personaId);
  const [busy, setBusy] = useState<string | null>(null);
  const personas = useAgentStore((s) => s.personas);
  const nameFor = (pid: string) => personas.find((x) => x.id === pid)?.name ?? pid.slice(0, 8);

  if (pending.length === 0) return null;

  const resolve = async (id: string, approved: boolean) => {
    setBusy(id);
    try {
      await resolvePendingTriggerFire(id, approved);
      forget(id);
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
          <PendingFireRow
            key={pf.id}
            fire={pf}
            trigger={triggerFor(pf)}
            personaName={nameFor(pf.persona_id)}
            busy={busy === pf.id}
            onResolve={resolve}
          />
        ))}
      </div>
    </div>
  );
}

interface PendingFireRowProps {
  fire: PendingTriggerFire;
  trigger: PersonaTrigger | undefined;
  personaName: string;
  busy: boolean;
  onResolve: (id: string, approved: boolean) => void;
}

function PendingFireRow({ fire, trigger, personaName, busy, onResolve }: PendingFireRowProps) {
  const { t } = useTranslation();
  const p = t.triggers.pending_approval;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-card bg-background/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="typo-body text-foreground truncate">{personaName}</span>
          {trigger && (
            <span className="typo-caption px-1.5 py-0.5 rounded-card border border-primary/15 bg-secondary/40 text-foreground shrink-0 capitalize">
              {trigger.trigger_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 typo-caption text-foreground min-w-0">
          <span className="truncate">{fire.event_type}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime timestamp={fire.created_at} className="shrink-0" />
        </div>
      </div>
      <AsyncButton
        variant="secondary"
        size="sm"
        isLoading={busy}
        icon={<Play className="w-3.5 h-3.5" />}
        onClick={() => onResolve(fire.id, true)}
      >
        {p.run_now}
      </AsyncButton>
      <button
        type="button"
        disabled={busy}
        onClick={() => onResolve(fire.id, false)}
        className="px-2 py-1 rounded-card text-foreground hover:bg-secondary/40 disabled:opacity-50"
        title={p.discard}
        aria-label={p.discard}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

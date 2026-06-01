import { useState } from 'react';
import { Bell, Loader2, Reply, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  companionDismissProactive,
  companionEngageProactive,
  type ProactiveMessage,
} from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { storeBus } from '@/lib/storeBus';
import { setPendingIncidentDeepLink } from '@/features/overview/sub_incidents/libs/incidentDeepLink';
import { triggerKindLabel } from './athenaLabels';

/**
 * "Athena reached out" card. Rendered inline in the chat transcript at
 * the top of the message list when there are unresolved proactive
 * messages. Two paths:
 *   - **Engage** — turns the nudge into a real chat turn by sending
 *     the message text as the next user prompt. Resolves backend-side.
 *   - **Dismiss** — silent no-thanks. Just resolves.
 *
 * The card is non-blocking: the user can keep typing in the composer
 * while it's visible; engage/dismiss are explicit clicks.
 */
export function ProactiveCard({
  message,
  onEngaged,
  onDismissed,
}: {
  message: ProactiveMessage;
  onEngaged: (text: string) => void;
  onDismissed: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'engage' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (kind: 'engage' | 'dismiss') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'engage') {
        const result = await companionEngageProactive(message.id);
        // Incident-blocker nudges take the user to the Overview → Incidents
        // inbox (mirrors the compose-cockpit nav pattern), then deep-link the
        // specific incident's detail modal when the nudge carries its id.
        if (message.triggerKind === 'incident_blocker') {
          // setSidebarSection lives on the system store; setOverviewTab lives
          // on the overview store (same split other nav call-sites use).
          useSystemStore.getState().setSidebarSection('overview');
          useOverviewStore.getState().setOverviewTab('incidents');
          // triggerRef is the incident id. Latch it for the lazy-mounting inbox
          // (consumed on mount) AND emit live for an already-mounted inbox.
          // No triggerRef → fall back to just the navigation above.
          if (message.triggerRef) {
            setPendingIncidentDeepLink(message.triggerRef);
            storeBus.emit('incidents:open-detail', { incidentId: message.triggerRef });
          }
        }
        onEngaged(result.message);
      } else {
        await companionDismissProactive(message.id);
        onDismissed();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  // Trigger-kind specific accent so the card type is glanceable. Each
  // known kind gets its own band; unknown kinds fall through to the
  // primary accent so they're still visually anchored.
  const accent = accentForTrigger(message.triggerKind);

  return (
    <div
      className={`rounded-card border p-3.5 space-y-2 ${accent}`}
      data-testid="companion-proactive-card"
      data-companion-proactive-id={message.id}
      data-companion-proactive-kind={message.triggerKind}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-foreground">
          <Bell className="w-3.5 h-3.5" />
          {t.plugins.companion.proactive_label}
        </span>
        <span className="typo-caption text-foreground">
          · {triggerKindLabel(t, message.triggerKind)}
        </span>
      </div>
      <p className="typo-body text-foreground/90 leading-relaxed">
        {message.message}
      </p>
      {error && (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 typo-caption text-rose-400">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handle('engage')}
          disabled={busy !== null}
          data-testid="companion-proactive-engage"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 focus-ring"
        >
          {busy === 'engage' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Reply className="w-3.5 h-3.5" />
          )}
          {t.plugins.companion.proactive_engage}
        </button>
        <button
          onClick={() => handle('dismiss')}
          disabled={busy !== null}
          data-testid="companion-proactive-dismiss"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 hover:bg-foreground/10 text-foreground typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
        >
          {busy === 'dismiss' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
          {t.plugins.companion.proactive_dismiss}
        </button>
      </div>
    </div>
  );
}

function accentForTrigger(kind: string): string {
  switch (kind) {
    case 'goal_target_approaching':
      return 'border-amber-500/30 bg-amber-500/[0.06]';
    case 'backlog_aging':
      return 'border-rose-500/30 bg-rose-500/[0.06]';
    case 'on_this_day':
      return 'border-violet-500/30 bg-violet-500/[0.06]';
    case 'cadence_due':
      return 'border-emerald-500/30 bg-emerald-500/[0.06]';
    case 'athena_scheduled':
      return 'border-sky-500/30 bg-sky-500/[0.06]';
    case 'ambient_match':
      return 'border-cyan-500/30 bg-cyan-500/[0.06]';
    case 'fleet_failed':
    case 'fleet_stuck_dispatched':
      return 'border-rose-500/30 bg-rose-500/[0.06]';
    case 'fleet_awaiting':
    case 'fleet_stale':
      return 'border-amber-500/30 bg-amber-500/[0.06]';
    case 'fleet_op_completed':
      return 'border-emerald-500/30 bg-emerald-500/[0.06]';
    case 'incident_blocker':
      return 'border-rose-500/30 bg-rose-500/[0.06]';
    default:
      return 'border-primary/30 bg-primary/[0.06]';
  }
}

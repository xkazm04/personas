import { extractMessage } from '@/lib/silentCatch';
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
import { applyClientAction } from './applyClientAction';

import Button from '@/features/shared/components/buttons/Button';

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
        // Message-digest nudges (Athena's triaged inbox summary) land the
        // user on Overview → Messages, where the attention-flagged items
        // are the remaining unread rows.
        if (message.triggerKind === 'message_digest') {
          useSystemStore.getState().setSidebarSection('overview');
          useOverviewStore.getState().setOverviewTab('messages');
        }
        // A revoked credential can only be fixed by the operator in their own
        // browser, so engaging takes them to the Vault with that credential
        // focused and the reconnect armed. Same screen state the orb's
        // decision and Athena's `reconnect_credential` client action produce:
        // one right answer to "show me this credential", reached three ways.
        if (message.triggerKind === 'credential_reauth' && message.triggerRef) {
          applyClientAction({
            type: 'reconnect_credential',
            credentialId: message.triggerRef,
          });
        }
        onEngaged(result.message);
      } else {
        await companionDismissProactive(message.id);
        onDismissed();
      }
    } catch (err: unknown) {
      setError(extractMessage(err));
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
        <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
          <Bell className="w-3.5 h-3.5" />
          {t.athena.proactive_label}
        </span>
        <span className="typo-caption text-foreground">
          · {triggerKindLabel(t, message.triggerKind)}
        </span>
      </div>
      <p className="typo-body text-ink-2">
        {message.message}
      </p>
      {error && (
        <div className="rounded-card border border-status-error/30 bg-status-error/10 px-2.5 py-1.5 typo-caption text-status-error">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        {/* Tinted primary, not solid: solid bg-primary + its white foreground
            is unreadable under light-primary themes. */}
        <Button
          type="button"
          onClick={() => handle('engage')}
          disabled={busy !== null}
          data-testid="companion-proactive-engage"
          variant="secondary"
          size="sm"
        >
          {busy === 'engage' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Reply className="w-3.5 h-3.5" />
          )}
          {t.athena.proactive_engage}
        </Button>
        <Button
          type="button"
          onClick={() => handle('dismiss')}
          disabled={busy !== null}
          data-testid="companion-proactive-dismiss"
          variant="ghost"
          size="sm"
        >
          {busy === 'dismiss' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
          {t.athena.proactive_dismiss}
        </Button>
      </div>
    </div>
  );
}

function accentForTrigger(kind: string): string {
  switch (kind) {
    case 'goal_target_approaching':
      return 'border-status-warning/30 bg-status-warning/10/[0.06]';
    case 'backlog_aging':
      return 'border-status-error/30 bg-status-error/10/[0.06]';
    case 'on_this_day':
      return 'border-hair-2 bg-surface-2/[0.06]';
    case 'cadence_due':
      return 'border-status-success/30 bg-status-success/10/[0.06]';
    case 'athena_scheduled':
      return 'border-status-info/30 bg-status-info/10/[0.06]';
    case 'ambient_match':
      return 'border-hair-2 bg-surface-2/[0.06]';
    case 'fleet_failed':
    case 'fleet_stuck_dispatched':
      return 'border-status-error/30 bg-status-error/10/[0.06]';
    case 'fleet_awaiting':
    case 'fleet_stale':
      return 'border-status-warning/30 bg-status-warning/10/[0.06]';
    case 'fleet_op_completed':
      return 'border-status-success/30 bg-status-success/10/[0.06]';
    case 'incident_blocker':
    case 'credential_reauth':
      return 'border-status-error/30 bg-status-error/10/[0.06]';
    case 'execution_review':
      return 'border-status-warning/30 bg-status-warning/10/[0.06]';
    case 'message_digest':
      return 'border-status-info/30 bg-status-info/10/[0.06]';
    default:
      return 'border-primary/30 bg-surface-2';
  }
}

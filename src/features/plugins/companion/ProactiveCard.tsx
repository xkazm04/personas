import { useState } from 'react';
import { Bell, Loader2, Reply, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  companionDismissProactive,
  companionEngageProactive,
  type ProactiveMessage,
} from '@/api/companion';

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

  // Trigger-kind specific accent so the card type is glanceable. Each of
  // the four known kinds gets its own band; the primary fallback is
  // reserved for future/unknown kinds so they're still visually anchored.
  const accent =
    message.triggerKind === 'goal_target_approaching'
      ? 'border-amber-500/30 bg-amber-500/[0.06]'
      : message.triggerKind === 'backlog_aging'
        ? 'border-rose-500/30 bg-rose-500/[0.06]'
        : message.triggerKind === 'on_this_day'
          ? 'border-violet-500/30 bg-violet-500/[0.06]'
          : message.triggerKind === 'cadence_due'
            ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
            : 'border-primary/30 bg-primary/[0.06]';

  return (
    <div
      className={`rounded-card border p-3.5 space-y-2 ${accent}`}
      data-testid="companion-proactive-card"
      data-companion-proactive-id={message.id}
      data-companion-proactive-kind={message.triggerKind}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-foreground/80">
          <Bell className="w-3.5 h-3.5" />
          {t.plugins.companion.proactive_label}
        </span>
        <span className="typo-caption text-foreground/50">
          · {triggerLabel(t, message.triggerKind)}
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 hover:bg-foreground/10 text-foreground/80 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
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

function triggerLabel(
  t: ReturnType<typeof useTranslation>['t'],
  kind: string,
): string {
  switch (kind) {
    case 'goal_target_approaching':
      return t.plugins.companion.proactive_kind_goal;
    case 'backlog_aging':
      return t.plugins.companion.proactive_kind_backlog;
    case 'cadence_due':
      return t.plugins.companion.proactive_kind_cadence;
    case 'on_this_day':
      return t.plugins.companion.proactive_kind_on_this_day;
    default:
      return kind;
  }
}

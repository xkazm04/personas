import { Sparkles, Check, X, AlertTriangle } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { sessionAttention, isNeverAttached, type FleetTileApproval } from './fleetAttention';

interface Props {
  session: FleetSession;
  /** Pending Athena proposals (fleet_send_input / fleet_intervene) for this session. */
  approvals: FleetTileApproval[];
  asking: boolean;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onAsk: (session: FleetSession) => void;
}

/**
 * The Athena copilot strip on a terminal tile. Three states, in priority:
 *   1. A pending suggestion → show Athena's proposed text + Approve / Dismiss
 *      (Approve writes it into the PTY via the existing approval pipeline).
 *   2. We just asked Athena → a "thinking" affordance.
 *   3. The session never attached an agent → a non-actionable "never attached"
 *      note (Athena can't help; kill + retry instead).
 *   4. The session is stale with nothing pending → an "Ask Athena" button that
 *      fires a session-scoped proactive turn.
 * Otherwise renders nothing (keeps healthy tiles clean).
 *
 * Clicks stopPropagation so they don't bubble to the tile's select handler.
 */
export function FleetTileAthenaBar({ session, approvals, asking, onApprove, onReject, onAsk }: Props) {
  const { t } = useTranslation();
  const suggestion = approvals[0];

  if (suggestion) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-t border-violet-400/30 bg-violet-500/12 shrink-0"
        data-testid={`fleet-athena-suggest-${session.id}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Sparkles className="w-3 h-3 text-violet-300 shrink-0" aria-hidden="true" />
        <span
          className="typo-caption truncate flex-1 min-w-0 text-violet-100 font-mono"
          title={suggestion.rationale}
        >
          {suggestion.text || suggestion.rationale}
        </span>
        <button
          type="button"
          data-testid={`fleet-athena-approve-${session.id}`}
          onClick={() => onApprove(suggestion.id)}
          aria-label={t.plugins.fleet.athena_approve_send}
          title={t.plugins.fleet.athena_approve_send}
          className="flex items-center rounded-interactive p-1 text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          data-testid={`fleet-athena-reject-${session.id}`}
          onClick={() => onReject(suggestion.id)}
          aria-label={t.plugins.fleet.athena_dismiss}
          title={t.plugins.fleet.athena_dismiss}
          className="flex items-center rounded-interactive p-1 text-foreground transition-colors hover:bg-secondary/50"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (asking) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-t border-primary/15 bg-secondary/30 shrink-0"
        data-testid={`fleet-athena-thinking-${session.id}`}
        role="status"
      >
        <Sparkles className="w-3 h-3 text-primary animate-pulse shrink-0" aria-hidden="true" />
        <span className="typo-caption text-foreground">{t.plugins.fleet.athena_thinking}</span>
      </div>
    );
  }

  if (isNeverAttached(session)) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-t border-rose-400/25 bg-rose-500/10 text-rose-200 shrink-0"
        data-testid={`fleet-athena-never-attached-${session.id}`}
        title={t.plugins.fleet.athena_never_attached_hint}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="typo-caption truncate">{t.plugins.fleet.athena_never_attached}</span>
      </div>
    );
  }

  if (sessionAttention(session) === 'stale') {
    return (
      <button
        type="button"
        data-testid={`fleet-athena-ask-${session.id}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => onAsk(session)}
        className="flex items-center gap-1.5 px-2 py-1 border-t border-amber-400/25 bg-amber-500/10 text-amber-200 transition-colors hover:bg-amber-500/20 shrink-0"
      >
        <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="typo-caption">{t.plugins.fleet.athena_ask}</span>
      </button>
    );
  }

  return null;
}

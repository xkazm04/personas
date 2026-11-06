import { Sparkles, Check, X, AlertTriangle } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { sessionAttention, isNeverAttached, type FleetTileApproval } from './fleetAttention';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
        className="flex items-center gap-1.5 px-2 py-1 border-t border-hair bg-surface-1 shrink-0"
        data-testid={`fleet-athena-suggest-${session.id}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Sparkles className="w-3 h-3 text-role-agent shrink-0" aria-hidden="true" />
        <Tooltip content={suggestion.rationale}><span
          className="typo-caption truncate flex-1 min-w-0 text-role-agent font-mono"
        >
          {suggestion.text || suggestion.rationale}
        </span></Tooltip>
        <Button variant="ghost" size="icon-sm"
          type="button"
          data-testid={`fleet-athena-approve-${session.id}`}
          onClick={() => onApprove(suggestion.id)}
          aria-label={t.plugins.fleet.athena_approve_send}
          tooltip={t.plugins.fleet.athena_approve_send}
        >
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm"
          type="button"
          data-testid={`fleet-athena-reject-${session.id}`}
          onClick={() => onReject(suggestion.id)}
          aria-label={t.plugins.fleet.athena_dismiss}
          tooltip={t.plugins.fleet.athena_dismiss}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  if (asking) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 border-t border-hair bg-surface-1 shrink-0"
        data-testid={`fleet-athena-thinking-${session.id}`}
        role="status"
      >
        <Sparkles className="w-3 h-3 text-ink-2 shrink-0" aria-hidden="true" />
        <span className="typo-caption text-foreground">{t.plugins.fleet.athena_thinking}</span>
      </div>
    );
  }

  if (isNeverAttached(session)) {
    return (
      <Tooltip content={t.plugins.fleet.athena_never_attached_hint}><div
        className="flex items-center gap-1.5 px-2 py-1 border-t border-hair bg-surface-1 text-status-error shrink-0"
        data-testid={`fleet-athena-never-attached-${session.id}`}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="typo-caption truncate">{t.plugins.fleet.athena_never_attached}</span>
      </div></Tooltip>
    );
  }

  if (sessionAttention(session) === 'stale') {
    return (
      <Button variant="accent" tone="warning" size="sm"
        type="button"
        data-testid={`fleet-athena-ask-${session.id}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => onAsk(session)}
        className="shrink-0"
      >
        <Sparkles className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span className="typo-caption">{t.plugins.fleet.athena_ask}</span>
      </Button>
    );
  }

  return null;
}

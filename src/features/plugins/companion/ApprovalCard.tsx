import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  companionApproveAction,
  companionRejectAction,
  type ClientAction,
  type PendingApproval,
} from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';
import type { SidebarSection } from '@/lib/types/types';

const VALID_ROUTES: SidebarSection[] = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
];

function applyClientAction(action: ClientAction) {
  // Currently only `navigate` exists, and that's handled directly via
  // the `companion://navigate` event (open_route bypasses approvals).
  // This stays as a defensive future-proof: if a *different* UI op
  // needs an approval gate later (e.g., prefill_persona_create), the
  // backend can populate clientAction and we'll dispatch from here.
  if (action.type === 'navigate') {
    const route = action.route as SidebarSection;
    if (!VALID_ROUTES.includes(route)) return;
    useSystemStore.getState().setSidebarSection(route);
  }
}

/**
 * Inline card rendered in the chat for each `propose_action` op Athena
 * emits. Approving runs the underlying action; rejecting just closes the
 * card and logs an episode.
 */
export function ApprovalCard({
  approval,
  onResolved,
}: {
  approval: PendingApproval;
  onResolved: (id: string, status: 'approved' | 'rejected') => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (kind: 'approve' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'approve') {
        const result = await companionApproveAction(approval.id);
        // UI-only ops (open_route) carry their follow-up here; we
        // dispatch BEFORE marking resolved so the panel collapses
        // smoothly rather than re-rendering with the card disappearing.
        if (result.clientAction) {
          applyClientAction(result.clientAction);
        }
      } else {
        await companionRejectAction(approval.id);
      }
      onResolved(approval.id, kind === 'approve' ? 'approved' : 'rejected');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  // Pretty-print the JSON params; fall back to raw on parse failure.
  let prettyParams: string;
  try {
    prettyParams = JSON.stringify(JSON.parse(approval.paramsJson), null, 2);
  } catch {
    prettyParams = approval.paramsJson;
  }

  return (
    <div className="rounded-card border border-primary/30 bg-primary/5 p-3.5 space-y-3 typo-body">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-primary">
          {t.plugins.companion.proposed_action}
        </span>
        <code className="typo-caption text-foreground/70 px-1.5 py-0.5 rounded bg-foreground/5">
          {approval.action}
        </code>
      </div>

      {approval.rationale && (
        <p className="text-foreground/80 leading-relaxed">{approval.rationale}</p>
      )}

      <details className="text-foreground/70">
        <summary className="cursor-pointer typo-caption hover:text-foreground transition-colors">
          {t.plugins.companion.action_params}
        </summary>
        <pre className="mt-1.5 typo-code px-2 py-1.5 rounded bg-foreground/5 overflow-x-auto">
          {prettyParams}
        </pre>
      </details>

      {error && (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 typo-caption text-rose-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => handle('approve')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus-ring"
        >
          {busy === 'approve' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          {t.plugins.companion.approve}
        </button>
        <button
          onClick={() => handle('reject')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 text-foreground/80 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-foreground/10 transition-colors focus-ring"
        >
          {busy === 'reject' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
          {t.plugins.companion.reject}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import {
  companionApproveAction,
  companionRejectAction,
  type ApprovalOutcome,
  type ClientAction,
  type PendingApproval,
} from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';
import { openExternalUrl } from '@/api/system/system';
import { toastCatch } from '@/lib/silentCatch';
import type { SidebarSection } from '@/lib/types/types';
import { actionLabel } from './athenaLabels';

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

const VALID_COMPANION_TABS = ['setup', 'memory', 'voice', 'decisions'] as const;

function applyClientAction(action: ClientAction) {
  if (action.type === 'navigate') {
    const route = action.route as SidebarSection;
    if (!VALID_ROUTES.includes(route)) return;
    useSystemStore.getState().setSidebarSection(route);
    return;
  }
  if (action.type === 'prefill_persona_create') {
    // Phase F: stash the prefill payload, then switch to the personas
    // section. UnifiedBuildEntry consumes the payload on mount (or on
    // next render if it's already mounted) and clears it.
    useSystemStore.getState().setCompanionPrefill({
      intent: action.intent,
      name: action.name,
      autoLaunch: action.autoLaunch,
      mode: action.mode === 'one_shot' ? 'one_shot' : 'interactive',
      companionSessionId: action.companionSessionId ?? null,
    });
    useSystemStore.getState().setSidebarSection('personas');
    return;
  }
  if (action.type === 'open_companion_tab') {
    // Phase F: deep-link into a specific tab inside the Companion
    // plugin. Three layers of state to set: top-level sidebar section
    // (`plugins`), which plugin is active (`companion`), and which
    // sub-tab inside the companion plugin. Order matters — sidebar
    // first so the route renders, then the tabs land before the
    // plugin page reads them on mount.
    if (
      !(VALID_COMPANION_TABS as readonly string[]).includes(action.tab)
    ) {
      return;
    }
    const sys = useSystemStore.getState();
    sys.setSidebarSection('plugins');
    sys.setPluginTab('companion');
    sys.setCompanionPluginTab(action.tab as (typeof VALID_COMPANION_TABS)[number]);
    return;
  }
  if (action.type === 'open_external_url') {
    // Open a dev project's test-environment URL in the browser via the
    // validated open_external_url command (http/https only).
    openExternalUrl(action.url).catch(toastCatch('ApprovalCard:openTestEnv'));
    return;
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
  onResolved: (id: string, status: ApprovalOutcome['status']) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedOutcome, setFailedOutcome] = useState<string | null>(null);

  const handle = async (kind: 'approve' | 'reject') => {
    setBusy(kind);
    setError(null);
    setFailedOutcome(null);
    try {
      if (kind === 'approve') {
        const result = await companionApproveAction(approval.id);
        if (result.status === 'approved_failed') {
          setFailedOutcome(result.message);
          setBusy(null);
          return;
        }
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
    <div
      className="rounded-card border border-primary/30 bg-primary/5 p-3.5 space-y-3 typo-body"
      data-companion-approval
      data-companion-approval-id={approval.id}
      data-companion-approval-action={approval.action}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-primary">
          {t.plugins.companion.proposed_action}
        </span>
        <span
          className="typo-caption font-medium text-foreground/85 px-2 py-0.5 rounded-input bg-foreground/5"
          title={approval.action}
        >
          {actionLabel(t, approval.action)}
        </span>
      </div>

      {approval.rationale && (
        <p className="text-foreground leading-relaxed">{approval.rationale}</p>
      )}

      <details className="text-foreground">
        <summary className="cursor-pointer typo-caption hover:text-foreground transition-colors">
          {t.plugins.companion.action_params}
        </summary>
        <div className="mt-1.5">
          <MarkdownRenderer
            content={'```json\n' + prettyParams + '\n```'}
            className="athena-chat-md"
            codeBlockActions
          />
        </div>
      </details>

      {error && (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 typo-caption text-rose-400">
          {error}
        </div>
      )}

      {failedOutcome && (
        <div className="rounded-card border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 typo-caption text-amber-300">
          {t.plugins.companion.approved_failed.replace(
            '{message}',
            failedOutcome.replace(/^Execution failed:\s*/i, ''),
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => handle('approve')}
          disabled={busy !== null || failedOutcome !== null}
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
          disabled={busy !== null || failedOutcome !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 text-foreground typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-foreground/10 transition-colors focus-ring"
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

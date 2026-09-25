/**
 * "Athena is waiting on you — the answer is on the orb."
 *
 * TWO DIMENSIONS, AND THIS IS NEITHER. The orb decides and the chat explains;
 * a third decision surface would split the operator's attention and let the
 * same approval be answered in two places. So this bar carries NO button that
 * decides anything. It names what is waiting, on which tab, and points at the
 * orb — which is already showing the numbered choice.
 *
 * Reading the pending item: `athenaStore.pendingDecision` is the one the
 * orb is showing, and an approval-sourced decision carries its approval's
 * `action` + `params` in `payload` (built in `decision/useDecisionQueue.ts`).
 * That is a JSON STRING of a JSON STRING, so it is parsed defensively and
 * every field checked before it is trusted — see the invariant comments below.
 */
import { AlertCircle } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useAthenaStore } from '@/features/companions/athena/athenaStore';

/** The browser ops that file an approval (WP3: `browser_act`, `browser_login`). */
const BROWSER_ACTIONS = new Set(['browser_act', 'browser_login']);

/**
 * Which tab the orb's pending decision is about, or null when it is not a
 * browser approval at all.
 *
 * INVARIANT for the narrowing: `payload` is a string this app serialised
 * (`JSON.stringify({ action, params, created_at })`) where `params` is itself
 * the approval's `paramsJson` — a blob Rust wrote. Nothing about either is
 * guaranteed at the type level, so every level is parsed in its own try and
 * every field is type-checked before use. A malformed payload yields null,
 * which renders nothing.
 */
export function pendingBrowserTabId(payload: string | undefined): number | null {
  if (!payload) return null;
  try {
    const outer: unknown = JSON.parse(payload);
    if (!outer || typeof outer !== 'object') return null;
    const { action, params } = outer as { action?: unknown; params?: unknown };
    if (typeof action !== 'string' || !BROWSER_ACTIONS.has(action)) return null;
    if (typeof params !== 'string') return null;
    const inner: unknown = JSON.parse(params);
    if (!inner || typeof inner !== 'object') return null;
    const { tab_id: tabId } = inner as { tab_id?: unknown };
    return typeof tabId === 'number' ? tabId : null;
  } catch {
    return null;
  }
}

export default function PendingApprovalBar({ tabId }: { tabId: number | null }) {
  const { t } = useTranslation();
  const pending = useAthenaStore((s) => s.pendingDecision);

  if (!pending || pending.source !== 'approval' || tabId === null) return null;
  if (pendingBrowserTabId(pending.payload) !== tabId) return null;

  return (
    <div
      role="status"
      data-testid="webview-pending-approval"
      className="flex items-center gap-2 px-3 py-1.5 rounded-card border border-amber-500/25 bg-amber-500/10 min-w-0"
    >
      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span className="typo-caption text-amber-400 truncate">{t.browser.webview.pending_body}</span>
    </div>
  );
}

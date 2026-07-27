import { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight, Cloud, GitBranch, FileText, RotateCcw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { targetBadge, type DeployTarget } from './deploymentTypes';

const HISTORY_ROW_HEIGHT = 30; // matches the li's py-1.5 + typo-caption line box
const HISTORY_CASCADE_ROWS = 14;
const HISTORY_GHOST_WIDTHS = ['w-32', 'w-24', 'w-40', 'w-28'];

/**
 * Unified deployment audit trail — one collapsible section that lists BOTH
 * Personas Cloud and GitLab deployment/sync history rows (backed by the
 * `list_deployment_history_all` query), newest first. Cloud rows were
 * previously never recorded; now they show up here alongside GitLab with a
 * target badge and a prompt-snapshot indicator.
 */
export function UnifiedDeploymentHistory() {
  const { t } = useTranslation();
  const dt = t.deployment.dashboard;
  const [open, setOpen] = useState(false);

  const history = useSystemStore((s) => s.unifiedDeploymentHistory);
  const loading = useSystemStore((s) => s.unifiedDeploymentHistoryLoading);
  const fetchHistory = useSystemStore((s) => s.fetchUnifiedDeploymentHistory);

  useEffect(() => {
    if (open) {
      fetchHistory(100).catch(
        toastCatch('UnifiedDeploymentHistory:fetch', 'Failed to load deployment history'),
      );
    }
  }, [open, fetchHistory]);

  // Ghost rows only into cold emptiness while the (re)fetch is running;
  // settled-only empty state. Row entrance cascades once per open (a
  // realtime/poll re-delivery of the same ids never replays it).
  const showGhost = loading && history.length === 0;
  const enter = useRevealTracker('unified-deployment-history');

  return (
    <div className="border-t border-primary/10 flex-shrink-0" data-testid="unified-deploy-history">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-6 py-2.5 typo-caption text-foreground hover:text-foreground/90 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <History className="w-3.5 h-3.5 text-foreground" />
        <span className="font-medium">{dt.history_title}</span>
        {history.length > 0 && (
          <span className="ml-1 text-foreground">
            <Numeric value={history.length} className="typo-caption" />
          </span>
        )}
      </button>

      {open && (
        <div className="max-h-64 overflow-auto px-6 pb-3">
          {showGhost ? (
            <HistoryGhostRows />
          ) : history.length === 0 ? (
            <p className="py-4 typo-caption text-foreground">{dt.history_empty}</p>
          ) : (
            <ul className="space-y-1">
              {history.map((r, index) => {
                const target: DeployTarget = r.target === 'cloud' ? 'cloud' : 'gitlab';
                const tb = targetBadge(target);
                const TargetIcon = target === 'cloud' ? Cloud : GitBranch;
                const isRollback = !!r.rolledBackFrom;
                // One-shot entrance cascade: first-viewport rows ripple; rows
                // past HISTORY_CASCADE_ROWS render plainly; entered ids never
                // replay on poll/refresh.
                return (
                  <RevealItem
                    as="li"
                    key={r.id}
                    revealId={r.id}
                    order={index}
                    hasEntered={(id) => index >= HISTORY_CASCADE_ROWS || enter.hasEntered(id)}
                    markEntered={enter.markEntered}
                    data-testid={`history-row-${r.id}`}
                    data-target={r.target}
                    className="flex items-center gap-2.5 py-1.5 typo-caption"
                  >
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card border ${tb.cls}`}
                    >
                      <TargetIcon className="w-3 h-3" />
                      {tb.label}
                    </span>
                    <span className="font-medium text-foreground/90 truncate max-w-[16rem]">
                      {r.personaName}
                    </span>
                    {isRollback && (
                      <Tooltip content={t.gitlab.rollback}>
                        <RotateCcw className="w-3 h-3 text-amber-400" />
                      </Tooltip>
                    )}
                    {r.snapshotPrompt && (
                      <Tooltip content={dt.history_snapshot}>
                        <FileText className="w-3 h-3 text-sky-400" data-testid={`history-snapshot-${r.id}`} />
                      </Tooltip>
                    )}
                    <span className="ml-auto text-foreground tabular-nums">
                      <RelativeTime timestamp={r.createdAt} />
                    </span>
                  </RevealItem>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryGhostRows — calm ghost rows for the ONLY moment the history list has
// nothing to show (fetch in flight, cold list). Same row height/geometry as
// the real `<li>` rows so the ghost -> content swap moves nothing. Entrance
// is delayed via `animate-fade-in` + staggered animation-delay starting at
// 120ms — a fast fetch never paints a single ghost. No `animate-pulse`.
// (docs/design/overview-loading.md §C)
// ---------------------------------------------------------------------------

function HistoryGhostRows() {
  return (
    <ul className="space-y-1" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const nameW = HISTORY_GHOST_WIDTHS[i % HISTORY_GHOST_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return (
          <li
            key={i}
            className="flex items-center gap-2.5 py-1.5 animate-fade-in"
            style={{ height: HISTORY_ROW_HEIGHT, animationDelay: delay }}
          >
            <span className="inline-block h-5 w-16 rounded-card bg-primary/[0.06]" />
            <span className={`h-3 ${nameW} max-w-full rounded bg-primary/[0.06]`} />
            <span className="ml-auto h-3 w-12 rounded bg-primary/[0.06]" />
          </li>
        );
      })}
    </ul>
  );
}

export default UnifiedDeploymentHistory;

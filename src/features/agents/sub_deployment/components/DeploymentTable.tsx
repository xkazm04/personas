import {
  Cloud, GitBranch, Pause, Play, Trash2, ExternalLink, FlaskConical, X,
} from 'lucide-react';
import type { UnifiedDeployment, SortKey, SortDir } from './deploymentTypes';
import { statusBadge, targetBadge, timeAgo } from './deploymentTypes';
import { statusIcon, SortHeader, ActionButton } from './DeploymentSubComponents';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { DeploymentHealthSparkline } from './DeploymentHealthSparkline';
import type { HealthDataPoint } from './DeploymentHealthSparkline';
import { AsyncButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TestResult } from '../hooks/useDeploymentTest';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

interface TestStateMap {
  [deploymentId: string]: { running: boolean; result: TestResult | null };
}

/**
 * Rows in the first viewport that play the one-shot entrance cascade when a
 * fresh result set lands (35ms stagger, id-guarded so polling/refresh never
 * replay it). Mirrors GlobalExecutionList's CASCADE_ROWS
 * (docs/design/overview-loading.md).
 */
const CASCADE_ROWS = 14;
const CASCADE_STEP_MS = 35;
const CASCADE_MAX_STAGGER = 8;

interface DeploymentTableProps {
  displayRows: UnifiedDeployment[];
  /** Ghost placeholder rows for the cold-empty + fetching moment (§C). */
  showGhost?: boolean;
  /** Reset key for the row entrance cascade — a filter/search/sort switch replays it. */
  revealResetKey?: string;
  busyId: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (key: SortKey) => void;
  handleAction: (id: string, action: () => Promise<void>) => void;
  cloudPauseDeploy: (id: string) => Promise<void>;
  cloudResumeDeploy: (id: string) => Promise<void>;
  cloudRemoveDeploy: (id: string) => Promise<void>;
  gitlabUndeployAgent: (projectId: number, agentId: string) => Promise<void>;
  healthMap?: Record<string, HealthDataPoint[]>;
  testStates?: TestStateMap;
  onTest?: (deploymentId: string, personaId: string) => void;
  onDismissTest?: (deploymentId: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
}

export function DeploymentTable({
  displayRows,
  showGhost,
  revealResetKey,
  busyId,
  sortKey,
  sortDir,
  toggleSort,
  handleAction,
  cloudPauseDeploy,
  cloudResumeDeploy,
  cloudRemoveDeploy,
  gitlabUndeployAgent,
  healthMap,
  testStates,
  onTest,
  onDismissTest,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: DeploymentTableProps) {
  const { t } = useTranslation();
  const dt = t.deployment.dashboard;
  const allSelected = displayRows.length > 0 && displayRows.every((r) => selectedIds.has(r.id));
  const someSelected = displayRows.some((r) => selectedIds.has(r.id));
  const enter = useRevealTracker(revealResetKey);
  const reducedMotion = useReducedMotion();
  return (
    <table className="w-full typo-body">
      <thead className="sticky top-0 z-10 bg-secondary/60 backdrop-blur-sm border-b border-primary/10">
        <tr>
          <th className="px-4 py-2.5 w-10">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
              onChange={onToggleSelectAll}
              className="w-3.5 h-3.5 rounded border-primary/30 bg-secondary/30 accent-primary cursor-pointer"
            />
          </th>
          <SortHeader label={dt.col_name} sortKey="name" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label={dt.col_target} sortKey="target" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label={dt.col_status} sortKey="status" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label={dt.col_invocations} sortKey="invocations" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
          <th className="px-4 py-2.5 text-left typo-label text-foreground">{dt.col_health}</th>
          <SortHeader label={dt.col_last_activity} sortKey="lastActivity" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label={dt.col_created} sortKey="createdAt" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <th className="px-4 py-2.5 text-left typo-label text-foreground">{dt.col_actions}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-primary/5">
        {showGhost && <DeploymentGhostRows />}
        {!showGhost && displayRows.map((row, index) => {
          const tb = targetBadge(row.target);
          const TargetIcon = row.target === 'cloud' ? Cloud : GitBranch;
          const isBusy = busyId === row.id;
          const testState = testStates?.[row.id];
          const testResult = testState?.result;

          // One-shot entrance cascade for a fresh result set (RevealItem
          // semantics, inlined here because RevealItem renders a <div> and
          // can't wrap a <tr>). Rows past the first viewport render plainly;
          // entered ids never replay on poll/refresh (docs/design/overview-loading.md).
          const animate = !reducedMotion && index < CASCADE_ROWS && !enter.hasEntered(row.id);
          const delay = animate ? Math.min(Math.max(0, index), CASCADE_MAX_STAGGER) * CASCADE_STEP_MS : 0;

          return (
            <tr
              key={row.id}
              className={`hover:bg-primary/5 transition-colors ${selectedIds.has(row.id) ? 'bg-primary/5' : ''} ${animate ? 'animate-fade-in' : ''}`}
              style={animate ? { animationDelay: `${delay}ms` } : undefined}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) enter.markEntered(row.id);
              }}
            >
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.id)}
                  onChange={() => onToggleSelect(row.id)}
                  className="w-3.5 h-3.5 rounded border-primary/30 bg-secondary/30 accent-primary cursor-pointer"
                />
              </td>
              <td className="px-4 py-3">
                <span className="typo-body font-medium text-foreground/90">{row.name}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 typo-caption font-medium rounded-card border ${tb.cls}`}>
                  <TargetIcon className="w-3 h-3" />
                  {tb.label}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  data-testid={`deploy-status-${row.id}`}
                  data-status={row.status}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 typo-caption font-medium rounded-card border ${statusBadge(row.status)}`}
                >
                  {statusIcon(row.status)}
                  {tokenLabel(t, 'deployment', row.status)}
                </span>
              </td>
              <td className="px-4 py-3 text-right typo-data text-foreground tabular-nums">
                {row.invocations > 0 ? <Numeric value={row.invocations} align="right" /> : '-'}
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const health = healthMap?.[row.id];
                  return health ? (
                    <DeploymentHealthSparkline daily={health} />
                  ) : (
                    <span className="typo-caption text-foreground">{row.target === 'cloud' ? t.common.loading : '-'}</span>
                  );
                })()}
              </td>
              <td className="px-4 py-3 text-foreground tabular-nums">
                {timeAgo(row.lastActivity)}
              </td>
              <td className="px-4 py-3 text-foreground tabular-nums">
                {timeAgo(row.createdAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-0.5">
                  {row.personaId && row.status === 'active' && onTest && (
                    <AsyncButton
                      variant="ghost"
                      size="icon-sm"
                      title={dt.test_deployment}
                      onClick={() => onTest(row.id, row.personaId!)}
                      disabled={isBusy}
                      isLoading={testState?.running ?? false}
                      icon={<FlaskConical className="w-3.5 h-3.5" />}
                      className="hover:!text-blue-400 hover:!bg-blue-500/10"
                    />
                  )}
                  {testResult && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 typo-caption font-medium rounded-card border ${
                        testResult.status === 'pass'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/10 border-red-500/20 text-red-400'
                      }`}
                      title={testResult.error ?? `${testResult.status === 'pass' ? 'Pass' : 'Fail'}${testResult.durationMs != null ? ` - ${testResult.durationMs}ms` : ''}${testResult.costUsd > 0 ? ` - $${testResult.costUsd.toFixed(4)}` : ''}`}
                    >
                      {testResult.status === 'pass' ? 'PASS' : 'FAIL'}
                      {testResult.durationMs != null && (
                        <Numeric value={testResult.durationMs} unit="ms" className="text-foreground" />
                      )}
                      {onDismissTest && (
                        <button
                          type="button"
                          onClick={() => onDismissTest(row.id)}
                          className="p-0 ml-0.5 hover:text-foreground/80 transition-colors cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  )}
                  {row._cloud && row.status === 'active' && (
                    <ActionButton
                      title={dt.action_pause}
                      icon={Pause}
                      hoverColor="hover:text-amber-400 hover:bg-amber-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => cloudPauseDeploy(row._cloud!.id))}
                    />
                  )}
                  {row._cloud && row.status === 'paused' && (
                    <ActionButton
                      title={dt.action_resume}
                      icon={Play}
                      hoverColor="hover:text-emerald-400 hover:bg-emerald-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => cloudResumeDeploy(row._cloud!.id))}
                    />
                  )}
                  {row._cloud && (
                    <ActionButton
                      title={dt.action_undeploy}
                      icon={Trash2}
                      hoverColor="hover:text-red-400 hover:bg-red-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => cloudRemoveDeploy(row._cloud!.id))}
                    />
                  )}
                  {row._gitlab && row._gitlabProjectId && (
                    <ActionButton
                      title={dt.action_undeploy}
                      icon={Trash2}
                      hoverColor="hover:text-red-400 hover:bg-red-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => gitlabUndeployAgent(row._gitlabProjectId!, row._gitlab!.id))}
                    />
                  )}
                  {sanitizeExternalUrl(row.webUrl) && (
                    <a
                      href={sanitizeExternalUrl(row.webUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={row.target === 'gitlab' ? dt.open_gitlab : dt.open_endpoint}
                      className="p-1.5 rounded-card text-foreground hover:text-foreground/80 hover:bg-secondary/50 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// DeploymentGhostRows — calm ghost rows for the ONLY moment the table body
// has nothing to show (a fetch with a cold store / empty filter context).
// Same column geometry as the real rows so the ghost -> content swap moves
// nothing. Each ghost enters via `animate-fade-in` behind a staggered
// animation-delay starting at 120ms (fill-mode: both holds opacity 0 through
// the delay), so a fetch that resolves quickly never paints a single ghost.
// No `animate-pulse` — the entrance stagger is the only motion.
// (docs/design/overview-loading.md §C)
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghosts read as rows, not a barcode. */
const GHOST_NAME_WIDTHS = ['w-36', 'w-24', 'w-32', 'w-28'];
const GHOST_ROW_COUNT = 8;

function DeploymentGhostRows() {
  return (
    <>
      {Array.from({ length: GHOST_ROW_COUNT }).map((_, i) => {
        const nameW = GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return (
          <tr key={i} aria-hidden="true" className="animate-fade-in" style={{ animationDelay: delay }}>
            <td className="px-4 py-3">
              <span className="block w-3.5 h-3.5 rounded bg-primary/[0.06]" />
            </td>
            <td className="px-4 py-3">
              <span className={`block h-3.5 ${nameW} max-w-full ${GHOST_BAR}`} />
            </td>
            <td className="px-4 py-3">
              <span className="inline-block h-5 w-16 rounded-card bg-primary/[0.06]" />
            </td>
            <td className="px-4 py-3">
              <span className="inline-block h-5 w-20 rounded-card bg-primary/[0.06]" />
            </td>
            <td className="px-4 py-3 text-right">
              <span className={`inline-block h-3.5 w-10 ${GHOST_BAR}`} />
            </td>
            <td className="px-4 py-3">
              <span className={`block h-3.5 w-20 ${GHOST_BAR}`} />
            </td>
            <td className="px-4 py-3">
              <span className={`block h-3.5 w-16 ${GHOST_BAR}`} />
            </td>
            <td className="px-4 py-3">
              <span className={`block h-3.5 w-16 ${GHOST_BAR}`} />
            </td>
            <td className="px-4 py-3">
              <span className="block h-5 w-14 rounded-card bg-primary/[0.06]" />
            </td>
          </tr>
        );
      })}
    </>
  );
}

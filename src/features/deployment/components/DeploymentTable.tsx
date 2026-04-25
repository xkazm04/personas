import {
  Cloud, GitBranch, Pause, Play, Trash2, ExternalLink, FlaskConical, X,
} from 'lucide-react';
import type { UnifiedDeployment, SortKey, SortDir } from './deploymentTypes';
import { statusBadge, targetBadge, timeAgo } from './deploymentTypes';
import { statusIcon, SortHeader, ActionButton } from './DeploymentSubComponents';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { DeploymentHealthSparkline } from './DeploymentHealthSparkline';
import type { HealthDataPoint } from './DeploymentHealthSparkline';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { TestResult } from '../hooks/useDeploymentTest';
import { useTranslation } from '@/i18n/useTranslation';

interface TestStateMap {
  [deploymentId: string]: { running: boolean; result: TestResult | null };
}

interface DeploymentTableProps {
  displayRows: UnifiedDeployment[];
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
        {displayRows.map((row) => {
          const tb = targetBadge(row.target);
          const TargetIcon = row.target === 'cloud' ? Cloud : GitBranch;
          const isBusy = busyId === row.id;
          const testState = testStates?.[row.id];
          const testResult = testState?.result;

          return (
            <tr key={row.id} className={`hover:bg-primary/3 transition-colors ${selectedIds.has(row.id) ? 'bg-primary/5' : ''}`}>
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
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 typo-caption font-medium rounded-card border ${statusBadge(row.status)}`}>
                  {statusIcon(row.status)}
                  {row.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right typo-data text-foreground">
                {row.invocations > 0 ? row.invocations.toLocaleString() : '-'}
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
              <td className="px-4 py-3 text-foreground">
                {timeAgo(row.lastActivity)}
              </td>
              <td className="px-4 py-3 text-foreground">
                {timeAgo(row.createdAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-0.5">
                  {row.personaId && row.status === 'active' && onTest && (
                    <button
                      type="button"
                      title={dt.test_deployment}
                      onClick={() => onTest(row.id, row.personaId!)}
                      disabled={isBusy || testState?.running}
                      className="p-1.5 rounded-card text-foreground hover:text-blue-400
                                 hover:bg-blue-500/10 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {testState?.running ? <LoadingSpinner size="sm" /> : <FlaskConical className="w-3.5 h-3.5" />}
                    </button>
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
                        <span className="text-foreground">
                          {testResult.durationMs < 1000 ? `${testResult.durationMs}ms` : `${(testResult.durationMs / 1000).toFixed(1)}s`}
                        </span>
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

import {
  Cloud, GitBranch, Pause, Play, Trash2, ExternalLink,
} from 'lucide-react';
import type { UnifiedDeployment, SortKey, SortDir } from './deploymentTypes';
import { statusBadge, targetBadge, timeAgo } from './deploymentTypes';
import { statusIcon, SortHeader, ActionButton } from './DeploymentSubComponents';

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
}: DeploymentTableProps) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-secondary/60 backdrop-blur-sm border-b border-primary/10">
        <tr>
          <SortHeader label="Name" sortKey="name" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label="Target" sortKey="target" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label="Invocations" sortKey="invocations" current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" />
          <SortHeader label="Last Activity" sortKey="lastActivity" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <SortHeader label="Created" sortKey="createdAt" current={sortKey} dir={sortDir} onToggle={toggleSort} />
          <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-primary/5">
        {displayRows.map((row) => {
          const tb = targetBadge(row.target);
          const TargetIcon = row.target === 'cloud' ? Cloud : GitBranch;
          const isBusy = busyId === row.id;

          return (
            <tr key={row.id} className="hover:bg-primary/3 transition-colors">
              <td className="px-4 py-3">
                <span className="font-medium text-foreground/90">{row.name}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-lg border ${tb.cls}`}>
                  <TargetIcon className="w-3 h-3" />
                  {tb.label}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-lg border ${statusBadge(row.status)}`}>
                  {statusIcon(row.status)}
                  {row.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground/80">
                {row.invocations > 0 ? row.invocations.toLocaleString() : '-'}
              </td>
              <td className="px-4 py-3 text-muted-foreground/70">
                {timeAgo(row.lastActivity)}
              </td>
              <td className="px-4 py-3 text-muted-foreground/70">
                {timeAgo(row.createdAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-0.5">
                  {row._cloud && row.status === 'active' && (
                    <ActionButton
                      title="Pause"
                      icon={Pause}
                      hoverColor="hover:text-amber-400 hover:bg-amber-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => cloudPauseDeploy(row._cloud!.id))}
                    />
                  )}
                  {row._cloud && row.status === 'paused' && (
                    <ActionButton
                      title="Resume"
                      icon={Play}
                      hoverColor="hover:text-emerald-400 hover:bg-emerald-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => cloudResumeDeploy(row._cloud!.id))}
                    />
                  )}
                  {row._cloud && (
                    <ActionButton
                      title="Undeploy"
                      icon={Trash2}
                      hoverColor="hover:text-red-400 hover:bg-red-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => cloudRemoveDeploy(row._cloud!.id))}
                    />
                  )}
                  {row._gitlab && row._gitlabProjectId && (
                    <ActionButton
                      title="Undeploy"
                      icon={Trash2}
                      hoverColor="hover:text-red-400 hover:bg-red-500/10"
                      busy={isBusy}
                      onClick={() => handleAction(row.id, () => gitlabUndeployAgent(row._gitlabProjectId!, row._gitlab!.id))}
                    />
                  )}
                  {row.webUrl && (
                    <a
                      href={row.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={row.target === 'gitlab' ? 'Open in GitLab' : 'Open endpoint'}
                      className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground/80 hover:bg-secondary/50 transition-colors"
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

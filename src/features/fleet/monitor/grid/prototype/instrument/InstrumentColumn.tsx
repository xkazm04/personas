// InstrumentColumn — one project as an instrument stack. The header is a
// bracketed label over a hairline in the team's colour; pressing it scopes the
// rail (the baseline's contract). Sessions follow the roster under a mono rule.

import type { ReactNode } from 'react';
import { Laptop, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useProjectForTeam } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { cleanName } from '../../fleetGridModel';
import type { ColumnRow } from '../../gridGeometry';
import type { BoardColumn } from '../../useBoardModel';
import { useWorkspaceName, WorkspaceInvitation } from '../../board/WorkspaceGroup';
import { Bracketed, MonoTag } from './parts';

export function InstrumentColumn({
  column, scoped, onToggleScope, renderRow,
}: {
  column: BoardColumn;
  scoped: boolean;
  onToggleScope: (teamId: string, teamName: string, roster: BoardColumn['cards']) => void;
  renderRow: (row: ColumnRow) => ReactNode;
}) {
  const { t, tx } = useTranslation();
  const name = cleanName(column.teamName);
  const workspaceId = column.workspaceId;
  const spaceName = useWorkspaceName(workspaceId) ?? name;
  const project = useProjectForTeam(column.remoteDevice ? null : column.teamId);
  const projectOff = project !== null && !project.enabled;
  const remote = !!column.remoteDevice;
  const hint = remote
    ? column.teamName
    : workspaceId !== null
      ? tx(t.monitor.grid_column_workspace_hint, { workspace: spaceName })
      : projectOff
        ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
        : tx(t.monitor.grid_column_scope, { project: name });

  const header = (
    <span className="flex w-full items-baseline gap-2">
      {remote && <Laptop className="h-3.5 w-3.5 flex-shrink-0 self-center text-primary" aria-hidden />}
      <Bracketed className="min-w-0 flex-1 typo-label uppercase tracking-wider text-foreground">{name}</Bracketed>
      {workspaceId !== null && (
        <MonoTag tone="border-primary/30 text-primary">{t.monitor.grid_column_workspace_badge}</MonoTag>
      )}
      {projectOff && (
        <MonoTag tone="border-status-warning/40 text-status-warning">
          <PowerOff className="h-3.5 w-3.5" aria-hidden />
          {t.plugins.dev_projects.project_state_off}
        </MonoTag>
      )}
      <span className="flex-shrink-0 typo-code tabular-nums text-foreground opacity-60">
        {String(remote ? column.rows.length : column.cards.length).padStart(2, '0')}
      </span>
    </span>
  );

  return (
    <section
      className={`flex min-w-0 flex-col gap-1 ${workspaceId !== null ? 'rounded-card border border-dashed border-primary/20 bg-primary/[0.03] p-2' : ''}`}
      data-testid="fleet-grid-column"
      data-workspace-group={workspaceId !== null || undefined}
    >
      <Tooltip content={hint}>
        {remote ? (
          <div className="px-1 py-1" data-testid="fleet-grid-column-header">{header}</div>
        ) : (
          <button
            type="button"
            onClick={() => onToggleScope(column.teamId, column.teamName, column.cards)}
            aria-pressed={scoped}
            data-testid="fleet-grid-column-header"
            className={`focus-ring w-full rounded-interactive px-1 py-1 text-left transition-colors ${
              scoped ? 'bg-primary/15' : 'hover:bg-foreground/[0.04]'
            }`}
          >
            {header}
          </button>
        )}
      </Tooltip>
      <span
        aria-hidden
        className="h-px w-full"
        style={{
          background: column.teamColor
            ? `linear-gradient(to right, ${colorWithAlpha(column.teamColor, 0.85)}, ${colorWithAlpha(column.teamColor, 0)})`
            : undefined,
        }}
      />
      {workspaceId !== null && column.rows.length === 0 ? (
        <WorkspaceInvitation text={tx(t.monitor.grid_column_workspace_empty, { workspace: spaceName })} />
      ) : (
        <div className={`flex max-h-[28rem] min-h-0 flex-col gap-0.5 overflow-y-auto pr-0.5 transition-opacity ${projectOff ? 'opacity-45 grayscale' : ''}`}>
          {column.rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)}
        </div>
      )}
    </section>
  );
}

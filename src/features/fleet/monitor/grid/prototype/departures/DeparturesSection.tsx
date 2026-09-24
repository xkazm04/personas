// Departures · DeparturesSection — one project as a titled ledger section.
// PROTOTYPE (variant C).
//
//   ■ bank-invest  WORKSPACE  OFF ……………………  2 agents · 1 live
//   ───────────────────────────────────────────────────────────
//   persona lines…
//   LIVE CLAUDE SESSIONS
//   session lines…
//
// The header IS the rail's scope control (click = scope the Log to this
// project; pressed while scoped), exactly as the baseline column header is.

import type { ReactNode } from 'react';
import { PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useProjectForTeam } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { cleanName } from '../../fleetGridModel';
import type { ColumnRow } from '../../gridGeometry';
import type { BoardColumn } from '../../useBoardModel';
import { useWorkspaceName, WorkspaceInvitation } from '../../board/WorkspaceGroup';

export function DeparturesSection({
  column, scoped, onToggleScope, renderRow,
}: {
  column: BoardColumn;
  scoped: boolean;
  onToggleScope: (teamId: string, teamName: string, roster: BoardColumn['cards']) => void;
  renderRow: (row: ColumnRow) => ReactNode;
}) {
  const { t, tx } = useTranslation();
  const name = cleanName(column.teamName);
  const workspace = column.workspaceId !== null;
  const spaceName = useWorkspaceName(column.workspaceId) ?? name;
  const project = useProjectForTeam(column.remoteDevice ? null : column.teamId);
  const off = project !== null && !project.enabled;
  const sessions = column.rows.filter((r) => r.kind === 'session' || r.kind === 'remote').length;
  const hint = workspace
    ? tx(t.monitor.grid_column_workspace_hint, { workspace: spaceName })
    : off
      ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
      : tx(t.monitor.grid_column_scope, { project: name });

  return (
    <section className="flex min-w-0 break-inside-avoid flex-col" data-testid="fleet-grid-column" data-workspace-group={workspace || undefined}>
      <Tooltip content={hint}>
        <button
          type="button"
          onClick={() => onToggleScope(column.teamId, column.teamName, column.cards)}
          aria-pressed={scoped}
          data-project-off={off || undefined}
          data-testid="fleet-grid-column-header"
          className={`focus-ring flex w-full items-center gap-2 border-b px-2 pb-1.5 pt-1 text-left transition-colors ${
            scoped ? 'border-primary bg-primary/10' : 'border-border/70 hover:bg-secondary/30'
          }`}
        >
          <span
            aria-hidden
            className="h-2 w-2 flex-shrink-0 rounded-none"
            style={{ backgroundColor: column.teamColor ? colorWithAlpha(column.teamColor, 0.9) : undefined }}
          />
          <span className={`min-w-0 truncate typo-title text-foreground ${off ? 'opacity-55' : ''}`}>{name}</span>
          {workspace && (
            <span className="flex-shrink-0 typo-label uppercase tracking-wide text-primary opacity-80">
              {t.monitor.grid_column_workspace_badge}
            </span>
          )}
          {off && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 typo-label uppercase tracking-wide text-status-warning">
              <PowerOff className="h-3.5 w-3.5" aria-hidden />
              {t.plugins.dev_projects.project_state_off}
            </span>
          )}
          <span className="ml-auto flex-shrink-0 typo-data tabular-nums text-foreground opacity-60">
            {column.cards.length}
            {sessions > 0 && <span className="text-primary"> · {sessions}</span>}
          </span>
        </button>
      </Tooltip>
      {workspace && column.rows.length === 0 ? (
        <WorkspaceInvitation text={tx(t.monitor.grid_column_workspace_empty, { workspace: spaceName })} />
      ) : (
        <div className={`flex flex-col ${off ? 'opacity-45 grayscale' : ''}`}>
          {column.rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)}
        </div>
      )}
    </section>
  );
}

/** The roster/sessions rule — a caption, not a box. */
export function SessionsCaption() {
  const { t } = useTranslation();
  return (
    <div className="px-2 pb-0.5 pt-2 typo-label uppercase tracking-wide text-foreground opacity-45">
      {t.monitor.grid_sessions}
    </div>
  );
}

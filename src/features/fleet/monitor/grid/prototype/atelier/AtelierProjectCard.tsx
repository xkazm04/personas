// Atelier project card — one team column as a soft surface. The header (team
// dot + name + roster count) IS the inbox scope: pressing it narrows the
// Inbox to this project, and the card wears a primary ring while it does.
// Personas first, then an "In flight" sub-section of the project's sessions.
// A workspace (cross-project) group is a tinted card spanning two tracks.

import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Layers, Laptop, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useProjectForTeam } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { cleanName } from '../../fleetGridModel';
import type { ColumnRow } from '../../gridGeometry';
import type { BoardColumn } from '../../useBoardModel';
import { useWorkspaceName } from '../../board/WorkspaceGroup';
import { SURFACE } from './parts';

export const AtelierProjectCard = memo(function AtelierProjectCard({
  column, scoped, onToggleScope, renderRow, reducedMotion,
}: {
  column: BoardColumn;
  scoped: boolean;
  onToggleScope: (teamId: string, teamName: string, roster: BoardColumn['cards']) => void;
  renderRow: (row: ColumnRow) => ReactNode;
  reducedMotion: boolean;
}) {
  const { t, tx } = useTranslation();
  const name = cleanName(column.teamName);
  const workspace = column.workspaceId !== null;
  const spaceName = useWorkspaceName(column.workspaceId) ?? name;
  const project = useProjectForTeam(column.remoteDevice ? null : column.teamId);
  const projectOff = project !== null && !project.enabled;
  const personas = column.rows.filter((r) => r.kind === 'persona');
  const flight = column.rows.filter((r) => r.kind === 'session' || r.kind === 'remote');

  const hint = workspace
    ? tx(t.monitor.grid_column_workspace_hint, { workspace: spaceName })
    : projectOff
      ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
      : tx(t.monitor.grid_column_scope, { project: name });

  const header = column.remoteDevice ? (
    <div className="flex items-center gap-2 px-2 pb-1 pt-1">
      <Laptop className="h-4 w-4 flex-shrink-0 text-foreground opacity-70" aria-hidden />
      <span className="min-w-0 flex-1 truncate typo-title text-foreground">{column.teamName}</span>
    </div>
  ) : (
    <Tooltip content={hint}>
      <button
        type="button"
        onClick={() => onToggleScope(column.teamId, column.teamName, column.cards)}
        aria-pressed={scoped}
        data-testid="fleet-grid-column-header"
        className="focus-ring flex w-full items-center gap-2 rounded-input px-2 py-1 text-left transition-colors hover:bg-secondary/40"
      >
        {workspace ? (
          <Layers className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
        ) : (
          <span aria-hidden className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: colorWithAlpha(column.teamColor, 0.9) }} />
        )}
        <span className="min-w-0 flex-1 truncate typo-title text-foreground">{workspace ? spaceName : name}</span>
        {workspace && (
          <span className="flex-shrink-0 rounded-pill bg-primary/15 px-2 typo-label text-primary">{t.monitor.grid_column_workspace_badge}</span>
        )}
        {projectOff && (
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-pill bg-status-warning/12 px-2 typo-label text-status-warning">
            <PowerOff className="h-3.5 w-3.5" aria-hidden />
            {t.plugins.dev_projects.project_state_off}
          </span>
        )}
        <span className="flex-shrink-0 typo-caption tabular-nums text-foreground opacity-60">{column.cards.length}</span>
      </button>
    </Tooltip>
  );

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex min-w-0 flex-col gap-1 p-2 ${SURFACE} ${
        workspace ? `bg-primary/[0.05] ${column.rows.length > 1 ? 'col-span-2' : ''}` : ''
      } ${scoped ? 'ring-2 ring-primary/60' : ''}`}
      data-testid="fleet-grid-column"
      data-workspace-group={workspace || undefined}
    >
      {header}
      {workspace && column.rows.length === 0 ? (
        <p className="px-2 pb-1 typo-caption text-foreground opacity-60" data-testid="fleet-grid-workspace-invite">
          {tx(t.monitor.grid_column_workspace_empty, { workspace: spaceName })}
        </p>
      ) : (
        <div className={`flex min-h-0 flex-col gap-0.5 ${projectOff ? 'opacity-50 grayscale' : ''}`}>
          <div className={workspace ? 'grid grid-cols-2 gap-0.5' : 'flex flex-col gap-0.5'}>
            {personas.map((r) => <div key={r.key}>{renderRow(r)}</div>)}
          </div>
          {flight.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1 rounded-input bg-foreground/[0.02] p-1.5">
              <span className="px-1 typo-label text-foreground opacity-60">In flight · {flight.length}</span>
              {flight.map((r) => <div key={r.key}>{renderRow(r)}</div>)}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
});

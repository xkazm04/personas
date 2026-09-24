// A project is a BAY: one plate of the panel, its team colour as the edge light
// on its nameplate, its agents as windows, its live sessions below a hairline.
//
// The nameplate is also a lamp: it lights with the worst state inside the bay,
// so on a board of forty bays the ones that need the operator are visible as
// light before a single name is read. Clicking it scopes the inbox to the bay.

import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Filter, Landmark, Laptop, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useProjectForTeam } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { cleanName, squareState } from '../../fleetGridModel';
import type { BoardColumn } from '../../useBoardModel';
import type { ColumnRow } from '../../gridGeometry';
import { useWorkspaceName } from '../../board/WorkspaceGroup';
import { PERSONA_LAMP, type Lamp as LampModel } from './tone';
import { Lamp } from './parts';

/** The bay's own lamp: the most urgent persona inside it. */
export function bayLamp(cards: BoardColumn['cards']): LampModel {
  let worst: LampModel = PERSONA_LAMP.idle;
  for (const c of cards) {
    const s = squareState(c);
    if (s === 'failed') return PERSONA_LAMP.failed;
    if (s === 'attention') worst = PERSONA_LAMP.attention;
    else if (s === 'running' && worst.tone === 'off') worst = PERSONA_LAMP.running;
  }
  return worst;
}

export const Bay = memo(function Bay({
  column, scoped, onScope, renderRow, reducedMotion, index,
}: {
  column: BoardColumn;
  scoped: boolean;
  onScope: (column: BoardColumn) => void;
  renderRow: (row: ColumnRow) => ReactNode;
  reducedMotion: boolean;
  index: number;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const name = cleanName(column.teamName);
  const group = column.workspaceId !== null;
  const remote = column.remoteDevice ?? null;
  const spaceName = useWorkspaceName(column.workspaceId) ?? name;
  const project = useProjectForTeam(remote ? null : column.teamId);
  const projectOff = project !== null && !project.enabled;
  const personas = column.rows.filter((r) => r.kind === 'persona');
  const live = column.rows.filter((r) => r.kind === 'session' || r.kind === 'remote');
  const lamp = bayLamp(column.cards);
  const hint = group
    ? tx(m.grid_column_workspace_hint, { workspace: spaceName })
    : projectOff ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
      : tx(m.grid_column_scope, { project: name });

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: 'easeOut', delay: reducedMotion ? 0 : Math.min(index, 12) * 0.02 }}
      className={`ae-plate flex min-w-0 flex-col gap-1.5 rounded-card p-2 ${group ? 'is-group' : ''} ${scoped ? 'is-scoped' : ''}`}
      data-testid="fleet-grid-column"
      data-workspace-group={group || undefined}
    >
      {remote ? (
        <div className="flex items-center gap-2 px-1 py-1">
          <Laptop className="h-4 w-4 flex-shrink-0 text-status-info" aria-hidden />
          <span className="min-w-0 flex-1 truncate typo-heading text-foreground">{tx(m.remote_on_device, { device: remote.displayName })}</span>
          <span className="typo-data tabular-nums text-foreground">{live.length}</span>
        </div>
      ) : (
        <Tooltip content={hint}>
          <button
            type="button"
            onClick={() => onScope(column)}
            aria-pressed={scoped}
            data-testid="fleet-grid-column-header"
            data-project-off={projectOff || undefined}
            className="ae-focus relative flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-input py-1 pl-3 pr-1.5 text-left transition-colors hover:bg-secondary/30"
          >
            <span aria-hidden className="absolute inset-y-1 left-0 w-1 rounded-full" style={{ backgroundColor: colorWithAlpha(column.teamColor || '#888888', 0.85), boxShadow: `0 0 10px ${colorWithAlpha(column.teamColor || '#888888', 0.6)}` }} />
            {group && <Landmark className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-primary" aria-label={m.grid_column_workspace_badge} />}
            <span className={`ae-clamp2 min-w-0 flex-1 typo-heading text-foreground ${projectOff ? 'line-through decoration-foreground/40' : ''}`}>{name}</span>
            {projectOff && <PowerOff className="h-3.5 w-3.5 flex-shrink-0 text-status-warning" aria-label={t.plugins.dev_projects.project_state_off} />}
            {scoped && <Filter className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />}
            <span className="typo-data tabular-nums text-foreground">{column.cards.length}</span>
            <Lamp lamp={lamp} className="mt-[7px]" />
          </button>
        </Tooltip>
      )}

      {group && column.rows.length === 0 ? (
        <Tooltip content={tx(m.grid_column_workspace_empty, { workspace: spaceName })}>
          <p className="ae-clamp2 px-1 typo-caption" data-testid="fleet-grid-workspace-invite">
            {tx(m.grid_column_workspace_empty, { workspace: spaceName })}
          </p>
        </Tooltip>
      ) : (
        <div className={`flex max-h-[26rem] min-h-0 flex-col gap-1 overflow-y-auto pr-0.5 ${projectOff ? 'opacity-50 grayscale' : ''}`}>
          {personas.map((r) => <div key={r.key}>{renderRow(r)}</div>)}
          {live.length > 0 && (
            <div className="mt-1 flex items-center gap-2 px-1" aria-label={m.grid_sessions}>
              <span className="h-px flex-1 bg-border" aria-hidden />
              <span className="typo-caption tabular-nums">{m.grid_sessions} · {live.length}</span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>
          )}
          {live.map((r) => <div key={r.key}>{renderRow(r)}</div>)}
        </div>
      )}
    </motion.section>
  );
});

// One project is one chassis in the room. Its cable colour (the team colour)
// runs down the left edge; its header plate is the inbox scope switch; under
// the plate a share bar draws the roster as lit and unlit modules, so a
// project's health reads from across the room. A powered-down project dims
// its whole body; a workspace group is a dashed enclosure; a paired device is
// a chassis with no roster.

import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Landmark, Laptop, Power, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { ContextMenu } from '@/features/shared/components/overlays/ContextMenu';
import { useProjectForTeam, useToggleProject } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { cleanName, squareState, SQUARE_STATE_ORDER } from '../../fleetGridModel';
import type { BoardColumn } from '../../useBoardModel';
import type { RailScope } from '../../useRailScope';
import { useWorkspaceName, WorkspaceGroupMenu, type ColumnMenuAnchor } from '../../board/WorkspaceGroup';

export function ShareBar({ cards }: { cards: BoardColumn['cards'] }) {
  if (cards.length === 0) return <div className="ed-share" aria-hidden />;
  const n = { running: 0, attention: 0, failed: 0, idle: 0 };
  for (const c of cards) n[squareState(c)] += 1;
  return (
    <div className="ed-share" aria-hidden>
      {SQUARE_STATE_ORDER.filter((s) => n[s] > 0).map((s) => (
        <span key={s} data-lamp={s} style={{ flexGrow: n[s] }} />
      ))}
    </div>
  );
}

export function Chassis({
  column, scoped, onToggleScope, index, motion, children,
}: {
  column: BoardColumn;
  scoped: boolean;
  onToggleScope: RailScope['toggleScope'];
  index: number;
  motion: boolean;
  children: ReactNode;
}) {
  const { t, tx } = useTranslation();
  const name = cleanName(column.teamName);
  const workspaceId = column.workspaceId;
  const remote = column.remoteDevice ?? null;
  const spaceName = useWorkspaceName(workspaceId) ?? name;
  const project = useProjectForTeam(remote ? null : column.teamId);
  const off = project !== null && !project.enabled;
  const toggleProject = useToggleProject();
  const [menu, setMenu] = useState<ColumnMenuAnchor | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (workspaceId === null && !project) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, anchor: e.currentTarget.getBoundingClientRect() });
  };
  const live = column.rows.filter((r) => r.kind === 'session' || r.kind === 'remote').length;

  const hint = remote ? tx(t.monitor.remote_on_device, { device: remote.displayName })
    : workspaceId !== null ? tx(t.monitor.grid_column_workspace_hint, { workspace: spaceName })
      : off ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
        : tx(t.monitor.grid_column_scope, { project: name });
  const style = {
    '--ed-cable': column.teamColor ? colorWithAlpha(column.teamColor, 0.85) : undefined,
    '--i': index,
  } as CSSProperties;

  const plate = (
    <>
      {workspaceId !== null && <Landmark className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />}
      {remote && <Laptop className="h-3.5 w-3.5 flex-shrink-0 text-status-info" aria-hidden />}
      <span className={`min-w-0 flex-1 truncate typo-label ${scoped ? 'text-primary' : 'text-foreground'}`}>
        {remote ? tx(t.monitor.remote_on_device, { device: remote.displayName }) : name}
      </span>
      {off && (
        <span className="inline-flex flex-shrink-0 items-center gap-1 typo-caption text-status-warning">
          <PowerOff className="h-3 w-3" aria-hidden />
          {t.plugins.dev_projects.project_state_off}
        </span>
      )}
      {live > 0 && (
        <span className="inline-flex flex-shrink-0 items-center gap-1 typo-caption tabular-nums text-primary">
          <span aria-hidden className="ed-lamp" data-lamp="live" />
          {live}
        </span>
      )}
      <span className="flex-shrink-0 typo-caption tabular-nums">{column.cards.length}</span>
    </>
  );

  return (
    <section
      className={`ed-chassis rounded-card ${motion ? 'ed-rise' : ''}`}
      style={style}
      data-group={workspaceId !== null || undefined}
      data-off={off || undefined}
      data-scoped={scoped || undefined}
      data-testid={remote ? 'fleet-grid-device-column' : 'fleet-grid-column'}
    >
      <Tooltip content={hint} delay={500}>
        {remote ? (
          // A paired device's chassis scopes nothing: its plate is a label, not a control.
          <div className="flex w-full items-center gap-2 rounded-t-card px-3 pb-2 pt-2.5" data-testid="fleet-grid-column-header">
            {plate}
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => onToggleScope(column.teamId, column.teamName, column.cards)}
            onContextMenu={onContextMenu}
            aria-pressed={scoped}
            data-project-off={off || undefined}
            data-testid="fleet-grid-column-header"
            className="w-full rounded-b-none rounded-t-card px-3 pb-2 pt-2.5 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-2"
          >
            {plate}
          </Button>
        )}
      </Tooltip>
      <ShareBar cards={column.cards} />

      {workspaceId !== null && column.rows.length === 0 ? (
        <Tooltip content={tx(t.monitor.grid_column_workspace_empty, { workspace: spaceName })}>
          <p data-testid="fleet-grid-workspace-invite" className="truncate px-3 py-2 typo-caption">
            {tx(t.monitor.grid_column_workspace_empty, { workspace: spaceName })}
          </p>
        </Tooltip>
      ) : (
        <div className="ed-chassis-body rounded-b-card">{children}</div>
      )}

      {workspaceId !== null && (
        <WorkspaceGroupMenu menu={menu} onCloseMenu={closeMenu} teamId={column.teamId} teamName={name} workspaceId={workspaceId} />
      )}
      {workspaceId === null && menu && project && createPortal(
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          ariaLabel={name}
          widthClass="w-52"
          items={[{
            id: 'toggle-project',
            label: project.enabled ? t.plugins.dev_projects.project_switch_off : t.plugins.dev_projects.project_switch_on,
            icon: project.enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />,
            onSelect: () => { void toggleProject(project); },
          }]}
        />,
        document.body,
      )}
    </section>
  );
}

// A project is a BAY: one plate of the panel. Its nameplate carries the team
// colour as an edge light, the live-session count and the roster count, and is
// itself a lamp lit with the worst state inside the bay - so on a board of
// forty bays the ones that need the operator show before a name is read.
// Under it, the roster drawn as its states (the share bar), then one flat line
// per agent and a two-row line per live session. Clicking the nameplate scopes
// the inbox; right-clicking it switches the project (or opens the workspace
// group's menu).

import { Button } from '@/features/shared/components/buttons';
import { memo, useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Landmark, Laptop, Power, PowerOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ContextMenu } from '@/features/shared/components/overlays/ContextMenu';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useProjectForTeam, useToggleProject } from '@/features/plugins/dev-tools/sub_projects/projectSwitch/useProjectSwitch';
import { cleanName, squareState, SQUARE_STATE_ORDER } from '../../fleetGridModel';
import type { BoardColumn } from '../../useBoardModel';
import { useWorkspaceName, WorkspaceGroupMenu, type ColumnMenuAnchor } from '../../board/WorkspaceGroup';
import { PERSONA_LAMP, toneClass, type Lamp as LampModel } from './tone';
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

export function ShareBar({ cards }: { cards: BoardColumn['cards'] }) {
  const n = { running: 0, attention: 0, failed: 0, idle: 0 };
  for (const c of cards) n[squareState(c)] += 1;
  return (
    <span className="ae-share mx-2" aria-hidden>
      {SQUARE_STATE_ORDER.filter((s) => n[s] > 0).map((s) => (
        <span key={s} className={toneClass(PERSONA_LAMP[s].tone)} style={{ flexGrow: n[s], opacity: s === 'idle' ? 0.35 : 1 }} />
      ))}
    </span>
  );
}

export const Bay = memo(function Bay({
  column, rows, liveCount, scoped, onScope,
}: {
  column: BoardColumn;
  /** The bay's lines, already filtered and rendered. */
  rows: ReactNode;
  liveCount: number;
  scoped: boolean;
  onScope: (column: BoardColumn) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
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
  const lamp = bayLamp(column.cards);
  const hint = remote ? tx(m.remote_on_device, { device: remote.displayName })
    : workspaceId !== null ? tx(m.grid_column_workspace_hint, { workspace: spaceName })
      : off ? tx(t.plugins.dev_projects.project_off_hint, { project: name })
        : tx(m.grid_column_scope, { project: name });
  const edge = column.teamColor || '#888888';

  return (
    <section
      className={`ae-plate flex min-w-0 flex-col overflow-hidden rounded-card ${workspaceId !== null ? 'is-group' : ''} ${scoped ? 'is-scoped' : ''}`}
      data-testid={remote ? 'fleet-grid-device-column' : 'fleet-grid-column'}
      data-workspace-group={workspaceId !== null || undefined}
    >
      <Tooltip content={hint} delay={500}>
        <Button
          variant="ghost"
          disabled={remote !== null}
          onClick={() => onScope(column)}
          onContextMenu={onContextMenu}
          aria-pressed={scoped}
          data-testid="fleet-grid-column-header"
          data-project-off={off || undefined}
          className="ae-focus relative w-full min-w-0 rounded-none py-2 pl-3.5 pr-2.5 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-2"
        >
          <span aria-hidden className="absolute inset-y-2 left-1 w-1 rounded-full" style={{ backgroundColor: colorWithAlpha(edge, 0.85), boxShadow: `0 0 10px ${colorWithAlpha(edge, 0.6)}` }} />
          {workspaceId !== null && <Landmark className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-label={m.grid_column_workspace_badge} />}
          {remote && <Laptop className="h-3.5 w-3.5 flex-shrink-0 text-status-info" aria-hidden />}
          <span className={`min-w-0 flex-1 truncate typo-heading ${scoped ? 'text-primary' : 'text-foreground'} ${off ? 'line-through decoration-foreground/40' : ''}`}>
            {remote ? tx(m.remote_on_device, { device: remote.displayName }) : name}
          </span>
          {off && <PowerOff className="h-3.5 w-3.5 flex-shrink-0 text-status-warning" aria-label={t.plugins.dev_projects.project_state_off} />}
          {scoped && <Filter className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />}
          {liveCount > 0 && (
            <span className="ae-t-run inline-flex flex-shrink-0 items-center gap-1 typo-caption tabular-nums text-primary">
              <Lamp lamp={{ tone: 'run', lit: true }} />{liveCount}
            </span>
          )}
          <span className="flex-shrink-0 typo-data tabular-nums text-foreground">{column.cards.length}</span>
          {!remote && <Lamp lamp={lamp} />}
        </Button>
      </Tooltip>
      <ShareBar cards={column.cards} />

      {workspaceId !== null && column.rows.length === 0 ? (
        <Tooltip content={tx(m.grid_column_workspace_empty, { workspace: spaceName })}>
          <p className="truncate px-3 py-2 typo-caption" data-testid="fleet-grid-workspace-invite">
            {tx(m.grid_column_workspace_empty, { workspace: spaceName })}
          </p>
        </Tooltip>
      ) : (
        <div className={`mt-1 flex max-h-[24rem] min-h-0 flex-col overflow-y-auto ${off ? 'opacity-50 grayscale' : ''}`}>{rows}</div>
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
});

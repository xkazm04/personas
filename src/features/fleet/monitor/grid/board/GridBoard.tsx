// GridBoard — the board body: the columns, the tray under them, and the two
// states that stand in for both.
//
// TWO KINDS OF NODE — one visual (`board/node/FleetNode`), and the difference
// is carried by shape as well as colour. A PERSONA node is solid, states its
// state on a full-height leading rail, and carries the one pending operation
// that wants the operator on its title row (`actionBadges`). A FLEET node is
// a little shorter, hollow, coloured on its border from the canonical
// `FLEET_STATE_META` the rest of the app reads, and CLICKABLE: it opens the
// session's live terminal. That asymmetry is the point. A persona is a
// permanent member you inspect; a fleet session is a process you talk to, and
// it dies when its task lands. A remote session is a third tile (`remote/`).
//
// The renderers live here rather than in `TeamColumn` because the tray renders
// the same two tiles from a different layout, and two copies of a tile's props
// are two copies that can disagree.
//
// THE BOARD WRAPS — as many columns to a row as its measured width holds, up
// to ten, each spread to fill the row. The wrap point and its measurement live
// in `useBoardRows`; `gridGeometry`'s "board's own wrap" and "width ladder"
// carry the reasoning and the costs they had to pay.
//
// TWO KINDS OF COLUMN, and the order is the model's. A workspace's
// cross-project group is pinned to the front of `model.columns` and draws
// itself framed (`TeamColumn` / `WorkspaceGroup`); this file treats it as any
// other column, which is the point — it is one column list, not two.
//
// `model.empty` still wins over a board of groups. Those columns render while
// they are empty, so a machine with workspaces and no personas has columns and
// nothing to put in them; `useBoardModel` answers emptiness from the ROWS, so
// the settled empty state below is still reachable there.

import { Fragment, useCallback, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import type { DrawerSection, PersonaCardModel } from '../../monitorModel';
import type { ChatBubble } from '../channelBubbleModel';
import { PersonaTile } from '../PersonaTile';
import { SessionTile } from '../SessionTile';
import { UngroupedTray } from '../UngroupedTray';
import { BoardGhost } from '../BoardGhost';
import { boardLayout, COLUMNS_PER_ROW, REMOTE_TILE_H, SESSION_TILE_H, TILE_H, TILE_W, type ColumnRow } from '../gridGeometry';
import type { BoardModel } from '../useBoardModel';
import type { RailScope } from '../useRailScope';
import { BoardColumnSlot } from '../remote/RemoteDeviceColumn';
import { RemoteSessionTile } from '../remote/RemoteSessionTile';
import { SessionDivider } from './SessionDivider';
import { useBoardRows } from './useBoardRows';

export interface GridBoardProps {
  model: BoardModel;
  /** The first-ever read has not landed and there is nothing warm to show. */
  isLoading: boolean;
  /** The tiles' stage has arrived (see `useStagedMount`). */
  staged: boolean;
  reducedMotion: boolean;
  focusKey: string | null;
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
  bubbles: ReadonlyMap<string, ChatBubble>;
  unseen: ReadonlyMap<string, number>;
  onOpenSession: (session: FleetSession) => void;
  onRecapSession: (session: FleetSession) => void;
  scopedTeamId: string | null;
  onToggleScope: RailScope['toggleScope'];
  onOpenRemote?: (jobId: string) => void; // a `remote:<jobId>` tile opens its drawer
}

export function GridBoard({
  model, isLoading, staged, reducedMotion, focusKey, selectedPersonaId, onSelect,
  bubbles, unseen, onOpenSession, onRecapSession, scopedTeamId, onToggleScope, onOpenRemote,
}: GridBoardProps) {
  const { t } = useTranslation();

  // The wrap point AND the column width, from the scroller's measured width.
  // `TILE_W` / `COLUMNS_PER_ROW` are the pre-measurement assumption; the moment
  // a measurement exists `boardLayout` takes over.
  const { boardRef, rows, columnWidth } = useBoardRows(
    model.columns, !model.empty, TILE_W, COLUMNS_PER_ROW, boardLayout,
  );

  const renderTile = useCallback(
    (c: PersonaCardModel, teamName: string | null = null, width = columnWidth) => (
      <PersonaTile
        key={c.personaId}
        card={c}
        teamName={teamName}
        selected={c.personaId === selectedPersonaId}
        onSelect={onSelect}
        width={width}
        height={TILE_H}
        flash={focusKey === `p:${c.personaId}`}
        bubble={bubbles.get(c.personaId) ?? null}
        unseenChat={unseen.get(c.personaId) ?? 0}
      />
    ),
    [selectedPersonaId, onSelect, focusKey, bubbles, unseen, columnWidth],
  );

  const renderSessionTile = useCallback(
    (s: FleetSession, width = columnWidth) => (
      <SessionTile
        key={s.id}
        session={s}
        width={width}
        height={SESSION_TILE_H}
        onOpen={onOpenSession}
        onRecap={onRecapSession}
        flash={focusKey === `s:${s.id}`}
      />
    ),
    [focusKey, onOpenSession, onRecapSession, columnWidth],
  );

  const renderColumnRow = useCallback(
    (row: ColumnRow): ReactNode => {
      if (row.kind === 'persona') return renderTile(row.card, row.teamName);
      if (row.kind === 'session') return renderSessionTile(row.session);
      if (row.kind === 'remote') return <RemoteSessionTile view={row.view} width={columnWidth} height={REMOTE_TILE_H} onOpen={onOpenRemote} />;
      return <SessionDivider label={t.monitor.grid_sessions} />;
    },
    [renderTile, renderSessionTile, t.monitor.grid_sessions, columnWidth, onOpenRemote],
  );

  // No scroller to measure here, so the ghost paints at what the hook holds:
  // the optimistic pre-measurement width cold, the last measured one warm.
  if (isLoading && model.empty) return <BoardGhost width={columnWidth} />;

  if (model.empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div className="relative">
          <div className="absolute inset-0 -m-6 rounded-full bg-primary/10 blur-2xl" />
          <Users className="relative h-8 w-8 text-foreground opacity-70" />
        </div>
        <p className="typo-body text-foreground">
          {model.filtered ? t.monitor.grid_filter_empty : t.monitor.channels_combined_quiet}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Rows of columns, scrolling vertically. Horizontal scroll survives only
          for a board too narrow to hold even one column — `boardLayout` has
          already taken the smaller of the ceiling and what fits. */}
      <div
        ref={boardRef}
        className="min-h-0 flex-1 overflow-auto p-3"
        aria-label={t.monitor.grid_board_aria}
      >
        <div className="flex min-w-max flex-col gap-3">
          {rows.map((row, i) => (
            <Fragment key={row[0]?.teamId ?? i}>
              {/* A subtle rule between rows, so a wrapped board reads as bands
                  rather than as one field of tiles. Never above the first. */}
              {i > 0 && <span aria-hidden className="h-px w-full flex-shrink-0 bg-border/60" />}
              <div className="flex flex-shrink-0 items-start gap-3" data-testid="fleet-grid-row">
                {row.map((column) => (
                  <BoardColumnSlot
                    key={column.teamId}
                    column={column}
                    scoped={scopedTeamId === column.teamId}
                    onToggleScope={onToggleScope}
                    width={columnWidth}
                    renderRow={renderColumnRow}
                    focusKey={focusKey}
                    staged={staged}
                    reducedMotion={reducedMotion}
                  />
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {/* Ungrouped tray — wrapped rows, windowed above 30 tiles. */}
      {(model.ungrouped.length > 0 || model.traySessions.length > 0) && (
        <div className="flex max-h-[32%] flex-shrink-0 flex-col gap-2 border-t border-border px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-foreground opacity-40" />
            <span className="typo-label text-foreground opacity-50">{t.monitor.grid_ungrouped}</span>
          </div>
          <UngroupedTray
            cards={model.ungrouped}
            sessions={model.traySessions}
            // THE TRAY STAYS AT THE NODE WIDTH — its wrap point is `trayPerRow`,
            // measured with `TILE_W`, and a wider tile would overflow that row.
            renderPersona={(c) => renderTile(c, null, TILE_W)}
            renderSession={(s) => renderSessionTile(s, TILE_W)}
          />
        </div>
      )}
    </>
  );
}

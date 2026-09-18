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
// it dies when its task lands.
//
// The renderers live here rather than in `TeamColumn` because the tray renders
// the same two tiles from a different layout, and two copies of a tile's props
// are two copies that can disagree.
//
// THE BOARD WRAPS — five columns to a row, scrolling vertically. The wrap point
// and its measurement live in `useBoardRows`; `gridGeometry`'s "board's own
// wrap" carries the reasoning and the two costs it had to pay.

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
import { SESSION_TILE_H, TILE_H, TILE_W, type ColumnRow } from '../gridGeometry';
import type { BoardModel } from '../useBoardModel';
import type { RailScope } from '../useRailScope';
import { TeamColumn } from './TeamColumn';
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
}

export function GridBoard({
  model, isLoading, staged, reducedMotion, focusKey, selectedPersonaId, onSelect,
  bubbles, unseen, onOpenSession, onRecapSession, scopedTeamId, onToggleScope,
}: GridBoardProps) {
  const { t } = useTranslation();

  const renderTile = useCallback(
    (c: PersonaCardModel, teamName: string | null = null) => (
      <PersonaTile
        key={c.personaId}
        card={c}
        teamName={teamName}
        selected={c.personaId === selectedPersonaId}
        onSelect={onSelect}
        width={TILE_W}
        height={TILE_H}
        flash={focusKey === `p:${c.personaId}`}
        bubble={bubbles.get(c.personaId) ?? null}
        unseenChat={unseen.get(c.personaId) ?? 0}
      />
    ),
    [selectedPersonaId, onSelect, focusKey, bubbles, unseen],
  );

  const renderSessionTile = useCallback(
    (s: FleetSession) => (
      <SessionTile
        key={s.id}
        session={s}
        width={TILE_W}
        height={SESSION_TILE_H}
        onOpen={onOpenSession}
        onRecap={onRecapSession}
        flash={focusKey === `s:${s.id}`}
      />
    ),
    [focusKey, onOpenSession, onRecapSession],
  );

  const renderColumnRow = useCallback(
    (row: ColumnRow): ReactNode => {
      if (row.kind === 'persona') return renderTile(row.card, row.teamName);
      if (row.kind === 'session') return renderSessionTile(row.session);
      return <SessionDivider label={t.monitor.grid_sessions} />;
    },
    [renderTile, renderSessionTile, t.monitor.grid_sessions],
  );

  const { boardRef, rows } = useBoardRows(model.columns, !model.empty);

  if (isLoading && model.empty) return <BoardGhost />;

  if (model.empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div className="relative">
          <div className="absolute inset-0 -m-6 rounded-full bg-primary/10 blur-2xl" />
          <Users className="relative h-8 w-8 text-foreground opacity-70" />
        </div>
        <p className="typo-body text-foreground">{t.monitor.channels_combined_quiet}</p>
      </div>
    );
  }

  return (
    <>
      {/* Rows of at most five columns, scrolling vertically. Horizontal scroll
          survives only for a board too narrow to hold even one full row —
          `boardPerRow` has already taken the smaller of five and what fits. */}
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
                  <TeamColumn
                    key={column.teamId}
                    column={column}
                    scoped={scopedTeamId === column.teamId}
                    onToggleScope={onToggleScope}
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
            renderPersona={(c) => renderTile(c, null)}
            renderSession={renderSessionTile}
          />
        </div>
      )}
    </>
  );
}

export default GridBoard;

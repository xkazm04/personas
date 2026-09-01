// FleetGridView — the "Activity" monitor surface, and the Monitor's baseline.
//
// A control-panel read on the whole fleet: every persona is a state-coloured
// TILE carrying its name, grouped by team into one-per-team columns. The column
// scrolls with the board, its header pinned. Teamless personas live in an
// "Ungrouped" tray below, wrapped into rows.
//
// Under each team's roster, a divider separates the personas from the LIVE
// CLAUDE SESSIONS dispatched into that team's projects (cwd → DevProject →
// team_id). Those are temporary processes, not fleet members, so they are
// shorter, hollow, and coloured on the border by session state — see
// fleetSessionModel. A column with no sessions shows no divider.
//
// State + grouping logic is shared (fleetGridModel) with the rest of the Monitor
// so a tile's colour always agrees with the other views. Clicking a tile selects
// the persona and opens the Monitor drawer.
//
// ---------------------------------------------------------------------------
// THE CONSOLIDATION (this pass)
//
// Activity was a board and nothing else: a bare grid of 38px squares floating on
// the Monitor's background, with a corner legend and no way to act on anything
// it showed. Every affordance the operator needed while looking at it lived
// somewhere else — reviews in Conversations' rail, accepted-but-unsent work in
// the triage deck, recent chatter in the Timeline, dispatching a session in an
// overlay that covered the board. Activity is now the room those things happen
// in, borrowing Conversations' geometry wholesale because Conversations is where
// this app's visual argument was already won:
//
//   • the CARD — `rounded-card border border-border` on a near-flat tint, with
//     `hud-corners` / `hud-bloom`, so the surface has an edge instead of
//     bleeding into the page;
//   • the HEADER — one 44px strip, round icon chip, one semibold title. The
//     floating corner legend is gone; the state key lives in the header as
//     count pills, which is where a key belongs when it also carries numbers;
//   • the RAIL — `ActivityRail`, the same 320px column with the same tab
//     styling, carrying Reviews / Dispatch / Messages over one row model and
//     one virtualized, infinite-loading scroller;
//   • the COMPOSER — `QuickDispatchDock`, which now sits in the MONITOR's
//     footer rather than inside this card, so the Timeline, Conversations and
//     the Map can dispatch too. It replaced a legend + count strip that only
//     restated things already on screen.
//
// And the tiles: 4× the width at the same height, so a persona is named rather
// than initialled (see `PersonaTile` for why the state colour moved from the
// fill to a leading rail at that aspect).
//
// TWO KINDS OF NODE, and the difference is carried by shape as well as colour.
// A PERSONA tile is solid, states its state on a full-height leading rail, and
// carries the one pending operation that wants the operator on its trailing
// edge (human gate, unread report, ready draft, failed run — `actionBadges`).
// A FLEET tile is shorter, hollow and dashed, coloured on its border from the
// canonical `FLEET_STATE_META` the rest of the app reads, and — since this pass
// — CLICKABLE: it opens the session's live terminal. That asymmetry is the
// point. A persona is a permanent member you inspect; a fleet session is a
// process you talk to, and it dies when its task lands.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Users } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DrawerSection, PersonaCardModel } from '../monitorModel';
import type { FeedTeam } from '../channels/types';
import {
  groupFleet, tallyStates, SQUARE_VISUAL, SQUARE_STATE_ORDER, cleanName, type SquareState,
} from './fleetGridModel';
import { PersonaTile } from './PersonaTile';
import { SessionTile } from './SessionTile';
import { ActivityRail } from './ActivityRail';
import { FleetTerminalModal } from './FleetTerminalModal';
import { SessionRecapModal } from './SessionRecapModal';
import { useSystemStore } from '@/stores/systemStore';
import { useFleetSessions } from './useFleetSessions';
import { ColumnBody } from './ColumnBody';
import { UngroupedTray } from './UngroupedTray';
import {
  TILE_W, TILE_H, SESSION_TILE_H, columnRows, type ColumnRow,
} from './gridGeometry';

/** Stable empty list so a session-less column never rebuilds its rows. */
const EMPTY_SESSIONS: FleetSession[] = [];

/** How long a node Athena pointed at stays ringed. Long enough to find with the
 *  eye once the scroll settles, short enough that it never becomes chrome. */
const FOCUS_FLASH_MS = 2600;

interface Props {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
  /** Teams whose channels the rail's Messages tab merges. Absent = the tab
   *  renders its empty state rather than subscribing to nothing. */
  feedTeams?: FeedTeam[];
  /** Scope the Monitor's Timeline to one speaker (a Messages row click). */
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
}

/**
 * The state key, in the header. It was a `pointer-events-none absolute` box in
 * the board's bottom-right corner — out of the way of the squares, and out of
 * the way of being read. At header width it is a row of count pills, which is
 * the same information without a floating overlay on top of the board.
 */
function StateTally({ totals, labels }: { totals: Record<SquareState, number>; labels: Record<SquareState, string> }) {
  return (
    <div className="ml-auto flex flex-shrink-0 items-center gap-1.5" data-testid="fleet-grid-tally">
      {SQUARE_STATE_ORDER.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/20 px-2 py-0.5 typo-caption text-foreground"
        >
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SQUARE_VISUAL[s].accent} ${SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''}`} />
          <span className="opacity-70">{labels[s]}</span>
          <span className="tabular-nums">{totals[s]}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The divider between a column's roster and its live sessions. It is a ROW of
 * the column now rather than a wrapper around the sessions — see
 * `gridGeometry.columnRows` for why. It is emitted only when the column HAS
 * sessions: an empty divider would read as "this team has a session lane and it
 * is empty", which is a different claim.
 */
function SessionDivider({ label }: { label: string }) {
  return (
    <span
      className="flex h-full items-end gap-1.5 pb-1 typo-caption text-foreground opacity-50"
      data-testid="fleet-grid-session-strip"
    >
      <span aria-hidden className="h-px flex-1 bg-border" />
      {label}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </span>
  );
}

function FleetGridViewImpl({
  cards, personas, teams, selectedPersonaId, onSelect, feedTeams, onOpenSpeaker,
}: Props) {
  const { t } = useTranslation();
  // The session whose terminal is open. Held as the SESSION rather than its id:
  // the registry patches rows underneath an open modal on every state event, and
  // an id re-resolved per render would swap the pane's subject mid-read. The
  // terminal itself is keyed on `session.id`, which does not change.
  // ATHENA'S POINTER. She names a node in her caption over this board; the orb
  // writes its key here and this is the end that acts on it. Consumed and then
  // cleared, like every other transient Monitor signal — a focus that persisted
  // would re-scroll the board every time the operator came back to it.
  //
  // The ring outlives the scroll deliberately: a scroll that lands with no mark
  // leaves the operator looking at a column, guessing which tile was meant.
  const focusNode = useSystemStore((s) => s.monitorFocusNode);
  const setFocusNode = useSystemStore((s) => s.setMonitorFocusNode);
  useEffect(() => {
    if (!focusNode) return;
    const id = setTimeout(() => setFocusNode(null), FOCUS_FLASH_MS);
    return () => clearTimeout(id);
  }, [focusNode, setFocusNode]);

  const [openSession, setOpenSession] = useState<FleetSession | null>(null);
  const closeSession = useCallback(() => setOpenSession(null), []);
  // The recap is the CHEAP read of a session — it mounts no xterm, so it can be
  // opened on any tile of a 200-session board without costing a subscription.
  // Held as the session for the same reason the terminal is (see above).
  const [recapSession, setRecapSession] = useState<FleetSession | null>(null);
  const closeRecap = useCallback(() => setRecapSession(null), []);
  const grouped = useMemo(() => groupFleet(cards, personas, teams), [cards, personas, teams]);
  const totals = useMemo(() => tallyStates(cards), [cards]);

  // Live Claude sessions, already grouped by team. Sessions bound to a team
  // that has no rendered column (every one of its personas is missing from the
  // fleet) would otherwise vanish, so they fall back into the Ungrouped tray
  // rather than being silently dropped.
  const sessionGroups = useFleetSessions();
  const traySessions = useMemo(() => {
    const rendered = new Set(grouped.teams.map((g) => g.teamId));
    const orphans: FleetSession[] = [];
    for (const [teamId, list] of sessionGroups.byTeam) {
      if (!rendered.has(teamId)) orphans.push(...list);
    }
    return orphans.length > 0 ? [...sessionGroups.ungrouped, ...orphans] : sessionGroups.ungrouped;
  }, [sessionGroups, grouped.teams]);

  const stateLabels: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };

  const empty =
    grouped.teams.length === 0 && grouped.ungrouped.length === 0 && traySessions.length === 0;

  // Each column's rows, with every height already decided (gridGeometry). Built
  // here rather than inside the column so a state event that changes ONE team's
  // sessions does not rebuild the row list of every other team.
  const columns = useMemo(
    () => grouped.teams.map((g) => ({
      ...g,
      rows: columnRows(g.cards, sessionGroups.byTeam.get(g.teamId) ?? EMPTY_SESSIONS),
    })),
    [grouped.teams, sessionGroups.byTeam],
  );

  const renderTile = useCallback(
    (c: PersonaCardModel) => (
      <PersonaTile
        key={c.personaId}
        card={c}
        selected={c.personaId === selectedPersonaId}
        onSelect={onSelect}
        width={TILE_W}
        height={TILE_H}
        flash={focusNode === `p:${c.personaId}`}
      />
    ),
    [selectedPersonaId, onSelect, focusNode],
  );

  const renderSessionTile = useCallback(
    (s: FleetSession) => (
      <SessionTile
        key={s.id}
        session={s}
        width={TILE_W}
        height={SESSION_TILE_H}
        onOpen={setOpenSession}
        onRecap={setRecapSession}
        flash={focusNode === `s:${s.id}`}
      />
    ),
    [focusNode],
  );

  const renderColumnRow = useCallback(
    (row: ColumnRow) => {
      if (row.kind === 'persona') return renderTile(row.card);
      if (row.kind === 'session') return renderSessionTile(row.session);
      return <SessionDivider label={t.monitor.grid_sessions} />;
    },
    [renderTile, renderSessionTile, t.monitor.grid_sessions],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border bg-foreground/[0.01] hud-corners hud-bloom">
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-foreground/[0.015] px-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15">
          <LayoutGrid className="h-3.5 w-3.5 text-foreground" />
        </div>
        <span className="typo-title">{t.monitor.activity_mode}</span>
        <StateTally totals={totals} labels={stateLabels} />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {empty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <div className="relative">
                <div className="absolute inset-0 -m-6 rounded-full bg-primary/10 blur-2xl" />
                <Users className="relative h-8 w-8 text-foreground opacity-70" />
              </div>
              <p className="typo-body text-foreground">{t.monitor.channels_combined_quiet}</p>
            </div>
          ) : (
            <>
              {/* The board — one column per team, scrolling horizontally. The
                  VERTICAL scroll is now per column rather than shared (see
                  ColumnBody's header for the geometry decision), so this
                  container scrolls on one axis only. */}
              <div
                className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3"
                aria-label={t.monitor.grid_board_aria}
              >
                <div className="flex h-full gap-3">
                  {columns.map((g) => (
                    <section
                      key={g.teamId}
                      className="flex h-full min-h-0 flex-shrink-0 flex-col gap-1.5"
                      style={{ width: TILE_W }}
                      data-testid="fleet-grid-column"
                    >
                      {/* Pinned team header. At square width this was an
                          initials chip with no roster count, "kept deliberately
                          minimal" because 38px had room for nothing else. The
                          constraint that motivated that is gone: the column is
                          a tile wide, so the team gets its real name and its
                          headcount. It now sits ABOVE the column's own scroller
                          rather than `sticky` against a shared one — the same
                          property, held structurally. */}
                      <div className="flex flex-shrink-0 flex-col gap-1 pb-2 pt-0.5">
                        <div className="flex items-baseline gap-1.5">
                          {/* The shared Tooltip, not `title=` — the name is the
                              one thing on this column that can truncate, so its
                              full form has to be reachable by keyboard and on
                              touch (golden path: tooltip). */}
                          <Tooltip content={cleanName(g.teamName)}>
                            <span className="min-w-0 flex-1 truncate typo-label text-foreground">
                              {cleanName(g.teamName)}
                            </span>
                          </Tooltip>
                          <span className="flex-shrink-0 typo-caption tabular-nums text-foreground opacity-50">
                            {g.cards.length}
                          </span>
                        </div>
                        <span
                          aria-hidden
                          className="h-0.5 w-full rounded-full"
                          style={{ backgroundColor: colorWithAlpha(g.teamColor, 0.55) }}
                        />
                      </div>
                      {/* Roster + sessions — one windowed stack of rows. */}
                      <ColumnBody rows={g.rows} renderRow={renderColumnRow} focusKey={focusNode} />
                    </section>
                  ))}
                </div>
              </div>

              {/* Ungrouped tray — wrapped rows, windowed above 30 tiles. */}
              {(grouped.ungrouped.length > 0 || traySessions.length > 0) && (
                <div className="flex max-h-[32%] flex-shrink-0 flex-col gap-2 border-t border-border px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-foreground opacity-40" />
                    <span className="typo-label text-foreground opacity-50">{t.monitor.grid_ungrouped}</span>
                  </div>
                  <UngroupedTray
                    cards={grouped.ungrouped}
                    sessions={traySessions}
                    renderPersona={renderTile}
                    renderSession={renderSessionTile}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <ActivityRail feedTeams={feedTeams ?? []} onOpenSpeaker={onOpenSpeaker} />
      </div>

      <FleetTerminalModal session={openSession} onClose={closeSession} />
      <SessionRecapModal session={recapSession} onClose={closeRecap} />
    </div>
  );
}

export const FleetGridView = memo(FleetGridViewImpl);
export default FleetGridView;

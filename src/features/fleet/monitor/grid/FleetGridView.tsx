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

import { memo, useMemo } from 'react';
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
import { useFleetSessions } from './useFleetSessions';

/**
 * Tile geometry. The width is 4× the 38px square this board used to paint, at
 * exactly the same height — the change that put persona names on the board
 * instead of two-letter initials. Both are constants rather than classes
 * because the column width is derived from the tile width, so the two cannot
 * drift.
 */
const TILE_W = 152;
const TILE_H = 38;
/** Sessions are visibly subordinate to the personas above them — same column
 *  width, less height. Not the same kind of citizen. */
const SESSION_TILE_H = 30;

/** Stable empty list so a session-less column never hands SessionStrip a new array. */
const EMPTY_SESSIONS: FleetSession[] = [];

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
 * The divider + session tiles under one column's roster. Renders NOTHING when
 * the column has no live sessions — an empty divider would read as "this team
 * has a session lane and it is empty", which is a different claim.
 */
function SessionStrip({ sessions, label }: { sessions: FleetSession[]; label: string }) {
  if (sessions.length === 0) return null;
  return (
    <>
      <span className="mt-1 flex items-center gap-1.5 typo-caption text-foreground opacity-50" data-testid="fleet-grid-session-strip">
        <span aria-hidden className="h-px flex-1 bg-border" />
        {label}
        <span aria-hidden className="h-px flex-1 bg-border" />
      </span>
      <div className="flex flex-col gap-1">
        {sessions.map((s) => (
          <SessionTile key={s.id} session={s} width={TILE_W} height={SESSION_TILE_H} />
        ))}
      </div>
    </>
  );
}

function FleetGridViewImpl({
  cards, personas, teams, selectedPersonaId, onSelect, feedTeams, onOpenSpeaker,
}: Props) {
  const { t } = useTranslation();
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

  const renderTile = (c: PersonaCardModel) => (
    <PersonaTile
      key={c.personaId}
      card={c}
      selected={c.personaId === selectedPersonaId}
      onSelect={onSelect}
      width={TILE_W}
      height={TILE_H}
    />
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
              {/* The board — one column per team, scrolling horizontally. */}
              <div className="min-h-0 flex-1 overflow-auto p-3" aria-label={t.monitor.grid_board_aria}>
                <div className="flex h-full gap-3">
                  {grouped.teams.map((g) => (
                    <section
                      key={g.teamId}
                      className="flex flex-shrink-0 flex-col gap-1.5"
                      style={{ width: TILE_W }}
                      data-testid="fleet-grid-column"
                    >
                      {/* Pinned team header. At square width this was an
                          initials chip with no roster count, "kept deliberately
                          minimal" because 38px had room for nothing else. The
                          constraint that motivated that is gone: the column is
                          a tile wide, so the team gets its real name and its
                          headcount. */}
                      <div className="sticky top-0 z-10 flex flex-col gap-1 bg-gradient-to-b from-background via-background to-transparent pb-2 pt-0.5">
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
                      {/* Roster — one-wide stack of tiles. */}
                      <div className="flex flex-col gap-1 pb-2">
                        {g.cards.map(renderTile)}
                        <SessionStrip
                          sessions={sessionGroups.byTeam.get(g.teamId) ?? EMPTY_SESSIONS}
                          label={t.monitor.grid_sessions}
                        />
                      </div>
                    </section>
                  ))}
                </div>
              </div>

              {/* Ungrouped tray — wrapped rows. */}
              {(grouped.ungrouped.length > 0 || traySessions.length > 0) && (
                <div className="flex max-h-[32%] flex-shrink-0 flex-col gap-2 border-t border-border px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-foreground opacity-40" />
                    <span className="typo-label text-foreground opacity-50">{t.monitor.grid_ungrouped}</span>
                  </div>
                  <div className="flex flex-wrap content-start items-center gap-1.5 overflow-auto pb-1">
                    {grouped.ungrouped.map(renderTile)}
                    {traySessions.map((s) => (
                      <SessionTile key={s.id} session={s} width={TILE_W} height={SESSION_TILE_H} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <ActivityRail feedTeams={feedTeams ?? []} onOpenSpeaker={onOpenSpeaker} />
      </div>
    </div>
  );
}

export const FleetGridView = memo(FleetGridViewImpl);
export default FleetGridView;

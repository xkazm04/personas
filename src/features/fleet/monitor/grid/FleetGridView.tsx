// FleetGridView — the "Activity" monitor surface.
//
// A control-panel read on the whole fleet (hundreds of personas): every persona
// is a state-coloured square with its initials, grouped by team into slim
// one-per-team columns. The team is just an initials chip with a colour divider
// beneath it (no roster count — kept deliberately minimal); the column scrolls
// with the board, its header pinned. Teamless personas live in an "Ungrouped"
// tray below, wrapped into rows. A compact legend keys the four states in the
// team section's bottom-right corner, out of the way of the squares themselves.
//
// Under each team's roster, a divider separates the personas from the LIVE
// CLAUDE SESSIONS dispatched into that team's projects (cwd → DevProject →
// team_id). Those are temporary processes, not fleet members, so they are
// smaller, hollow, and coloured on the border by session state — see
// fleetSessionModel. A column with no sessions shows no divider.
//
// State + grouping logic is shared (fleetGridModel) with the rest of the Monitor
// so a square's colour always agrees with the columns view. Clicking a square
// selects the persona and opens the Monitor drawer — the wired-in entry point
// for future "act on a persona from the grid" interactions.

import { memo, useMemo } from 'react';
import { Users } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { DrawerSection, PersonaCardModel } from '../monitorModel';
import {
  groupFleet, tallyStates, SQUARE_VISUAL, SQUARE_STATE_ORDER, type SquareState,
} from './fleetGridModel';
import { TeamBadge } from './TeamBadge';
import { PersonaSquare } from './PersonaSquare';
import { SessionSquare } from './SessionSquare';
import { useFleetSessions } from './useFleetSessions';

// 20% larger than the round-1 prototype (was 32) — easier targets, legible
// two-letter initials, still slim enough to fit a fleet on one board.
const SQUARE = 38;
// Sessions are visibly subordinate to the personas above them — same grid, not
// the same kind of citizen.
const SESSION_SQUARE = 30;

/** Stable empty list so a session-less column never hands SessionStrip a new array. */
const EMPTY_SESSIONS: FleetSession[] = [];

interface Props {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
}

/** Compact 2×2 state key, tucked into the team section's bottom-right corner. */
function Legend({ totals, labels }: { totals: Record<SquareState, number>; labels: Record<SquareState, string> }) {
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-20 grid grid-cols-2 gap-x-3 gap-y-1 rounded-card border border-primary/12 bg-background/85 px-2.5 py-1.5 shadow-elevation-2 backdrop-blur-sm">
      {SQUARE_STATE_ORDER.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 typo-caption text-foreground/65">
          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-[3px] ${SQUARE_VISUAL[s].accent} ${SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''}`} />
          {labels[s]}
          <span className="ml-auto tabular-nums text-foreground/40">{totals[s]}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The divider + session squares under one column's roster. Renders NOTHING when
 * the column has no live sessions — an empty divider would read as "this team
 * has a session lane and it is empty", which is a different claim.
 */
function SessionStrip({ sessions, label }: { sessions: FleetSession[]; label: string }) {
  if (sessions.length === 0) return null;
  return (
    <>
      <span aria-hidden className="my-0.5 h-0 w-7 border-t border-dashed border-foreground/25" />
      <div className="flex flex-col items-center gap-1.5" title={label} data-testid="fleet-grid-session-strip">
        {sessions.map((s) => (
          <SessionSquare key={s.id} session={s} size={SESSION_SQUARE} />
        ))}
      </div>
    </>
  );
}

function FleetGridViewImpl({ cards, personas, teams, selectedPersonaId, onSelect }: Props) {
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

  if (grouped.teams.length === 0 && grouped.ungrouped.length === 0 && traySessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Users className="h-8 w-8 text-foreground/40" />
        <span className="typo-body text-foreground/60">{t.monitor.channels_combined_quiet}</span>
      </div>
    );
  }

  const renderSquare = (c: PersonaCardModel) => (
    <PersonaSquare
      key={c.personaId}
      card={c}
      selected={c.personaId === selectedPersonaId}
      onSelect={onSelect}
      size={SQUARE}
    />
  );

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Team section — slim columns board with a corner legend. */}
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto">
          <div className="flex h-full gap-3 pb-2">
            {grouped.teams.map((g) => (
              <section key={g.teamId} className="flex flex-shrink-0 flex-col items-center gap-2">
                {/* Pinned team header — initials chip + colour divider (no count). */}
                <div className="sticky top-0 z-10 flex flex-col items-center gap-1.5 bg-gradient-to-b from-background via-background to-transparent pb-2 pt-0.5">
                  <TeamBadge name={g.teamName} color={g.teamColor} size={SQUARE} />
                  <span
                    aria-hidden
                    className="h-0.5 w-6 rounded-full"
                    style={{ backgroundColor: colorWithAlpha(g.teamColor, 0.55) }}
                  />
                </div>
                {/* Roster — one-wide stack of squares. */}
                <div className="flex flex-col items-center gap-1.5 pb-2">
                  {g.cards.map(renderSquare)}
                  <SessionStrip
                    sessions={sessionGroups.byTeam.get(g.teamId) ?? EMPTY_SESSIONS}
                    label={t.monitor.grid_sessions}
                  />
                </div>
              </section>
            ))}
          </div>
        </div>
        <Legend totals={totals} labels={stateLabels} />
      </div>

      {/* Ungrouped tray — wrapped rows. */}
      {(grouped.ungrouped.length > 0 || traySessions.length > 0) && (
        <div className="flex max-h-[32%] flex-shrink-0 flex-col gap-2 border-t border-primary/10 pt-2.5">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-foreground/40" />
            <span className="typo-label text-foreground/50">{t.monitor.grid_ungrouped}</span>
          </div>
          <div className="flex flex-wrap content-start items-center gap-1.5 overflow-auto pb-1">
            {grouped.ungrouped.map(renderSquare)}
            {traySessions.length > 0 && (
              <>
                {grouped.ungrouped.length > 0 && (
                  <span aria-hidden className="mx-1 h-7 w-0 self-center border-l border-dashed border-foreground/25" />
                )}
                {traySessions.map((s) => (
                  <SessionSquare key={s.id} session={s} size={SESSION_SQUARE} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const FleetGridView = memo(FleetGridViewImpl);
export default FleetGridView;

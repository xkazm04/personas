// fleetGridModel — pure logic for the Fleet Grid view.
//
// The grid is a control-panel read on the WHOLE fleet (hundreds of personas):
// every persona is a small square coloured by what it's doing right now, grouped
// by team. It reuses the Monitor's existing state machine — `pillarStateKey`
// already priority-resolves a card to running > failed > input_required >
// draft_ready > queued > attention > idle — and folds those seven into the FOUR
// states the grid paints, so colour here always agrees with the columns view.
//
// No JSX, no i18n → trivially unit-testable; the variants own the markup.

import { personaInitials } from '@/lib/icons/personaInitials';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { pillarStateKey, type PersonaCardModel } from '../monitorModel';

/** The four square states the grid paints. */
export type SquareState = 'running' | 'failed' | 'attention' | 'idle';

/**
 * Fold the Monitor's fine-grained pillar key into the grid's four buckets:
 *   • running   → executing a task            (pulsing theme colour)
 *   • failed    → last execution failed       (red)
 *   • attention → setup / human-review / queued / draft needing the user (warning)
 *   • idle      → nothing happening, nothing pending (dark gray)
 */
export function squareState(card: PersonaCardModel): SquareState {
  const k = pillarStateKey(card);
  if (k === 'running') return 'running';
  if (k === 'failed') return 'failed';
  if (k === 'idle') return 'idle';
  return 'attention'; // input_required | draft_ready | queued | attention
}

export interface SquareVisual {
  /** Square background + border classes. */
  box: string;
  /** Initials text colour class. */
  text: string;
  /** Accent dot / ring colour class (state hue at full strength). */
  accent: string;
  /** True → the square carries the live-work pulse. */
  pulse: boolean;
}

export const SQUARE_VISUAL: Record<SquareState, SquareVisual> = {
  running:   { box: 'bg-primary/20 border-primary/55',          text: 'text-primary',         accent: 'bg-primary',      pulse: true },
  failed:    { box: 'bg-red-500/20 border-red-500/55',          text: 'text-red-200',         accent: 'bg-red-400',      pulse: false },
  attention: { box: 'bg-amber-500/20 border-amber-500/50',      text: 'text-amber-100',       accent: 'bg-amber-400',    pulse: false },
  idle:      { box: 'bg-foreground/[0.05] border-foreground/12', text: 'text-foreground/45',  accent: 'bg-foreground/30', pulse: false },
};

/** Display order + label key for the legend (urgency-first). */
export const SQUARE_STATE_ORDER: SquareState[] = ['running', 'attention', 'failed', 'idle'];

/** Strip team/role prefixes so initials + labels read cleanly. */
export const cleanName = (n: string): string => n.replace(/^T:\s*/, '').replace(/^SDLC[ —-]*/i, '').trim() || n;

/** 1–2 letter initials for a persona or team name. */
export const initialsOf = (name: string): string => personaInitials(cleanName(name));

export interface TeamGroup {
  teamId: string;
  teamName: string;
  teamColor: string;
  cards: PersonaCardModel[];
}

export interface GroupedFleet {
  teams: TeamGroup[];
  /** Personas with no home team (or whose team isn't loaded). */
  ungrouped: PersonaCardModel[];
}

/**
 * Group the fleet's cards by persona `home_team_id`. Teams keep their roster
 * order from `teams`; only non-empty teams appear. Cards keep their incoming
 * order (already urgency-sorted by buildMonitorModel), so the most-urgent
 * persona sits first inside each group.
 */
export function groupFleet(cards: PersonaCardModel[], personas: Persona[], teams: PersonaTeam[]): GroupedFleet {
  const teamOf = new Map<string, string>();
  for (const p of personas) if (p.home_team_id) teamOf.set(p.id, p.home_team_id);
  const teamMeta = new Map(teams.map((tm) => [tm.id, tm]));

  const byTeam = new Map<string, PersonaCardModel[]>();
  const ungrouped: PersonaCardModel[] = [];
  for (const c of cards) {
    const tid = teamOf.get(c.personaId);
    if (tid && teamMeta.has(tid)) {
      const list = byTeam.get(tid);
      if (list) list.push(c);
      else byTeam.set(tid, [c]);
    } else {
      ungrouped.push(c);
    }
  }

  const teamGroups: TeamGroup[] = [];
  for (const tm of teams) {
    const cs = byTeam.get(tm.id);
    if (cs && cs.length > 0) {
      teamGroups.push({ teamId: tm.id, teamName: tm.name, teamColor: tm.color, cards: cs });
    }
  }
  return { teams: teamGroups, ungrouped };
}

/** Count squares by state across a card list (for per-group / legend tallies). */
export function tallyStates(cards: PersonaCardModel[]): Record<SquareState, number> {
  const t: Record<SquareState, number> = { running: 0, failed: 0, attention: 0, idle: 0 };
  for (const c of cards) t[squareState(c)] += 1;
  return t;
}

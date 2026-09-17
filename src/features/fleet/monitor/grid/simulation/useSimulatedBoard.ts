// useSimulatedBoard — the one seam the simulation substitutes through.
//
// It swaps at the BOARD'S INPUT BOUNDARY — the props `PersonaMonitor` hands
// down, the system store's `projects`, and the session registry's grouping —
// and nothing below it changes. `groupFleet`, `columnRows`, the scope control's
// name matching, the tray's fallback for unplaceable sessions, the virtualizer,
// every tile: all of it runs its real code against the fixture. A simulation
// that short-circuited further down would paint a board while proving nothing
// about the board.
//
// WHAT IS DELIBERATELY NOT SIMULATED: the speech bubbles. A bubble is a
// ten-second event with a fade timer behind it (`useChannelBubbles`), and a
// permanent fake one would misrepresent the mechanic rather than demonstrate
// it. The mark a bubble LEAVES BEHIND — the unread count on the tile — is
// durable state, so that one is simulated.

import { useMemo } from 'react';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { FleetQueueSnapshot } from '@/lib/bindings/FleetQueueSnapshot';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCardModel } from '../../monitorModel';
import type { SessionGrouping } from '../fleetSessionModel';
import { useSimQueue } from './useSimWorld';

export interface BoardInputs {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  projects: readonly DevProject[];
  sessions: SessionGrouping;
  /** The flat registry, for the queue boards (the grouping is for the columns). */
  sessionList: readonly FleetSession[];
  /** The door's snapshot; `null` until the first read lands. */
  queue: FleetQueueSnapshot | null;
  /** Unread channel lines per persona — the mark a bubble leaves behind. */
  unseen: ReadonlyMap<string, number>;
  isLoading: boolean;
}

/** Every fourth simulated agent has been talking while nobody was looking. */
function simUnseen(cards: PersonaCardModel[]): Map<string, number> {
  const out = new Map<string, number>();
  cards.forEach((card, i) => {
    if (i % 4 === 1) out.set(card.personaId, ((i * 7) % 11) + 1);
  });
  return out;
}

/**
 * The board's inputs: the live ones, or the simulated ones when the operator
 * has the toggle on. `live` is passed through untouched when it is off, so a
 * non-test build pays one boolean check and nothing else.
 */
export function useSimulatedBoard(enabled: boolean, live: BoardInputs): BoardInputs {
  // Subscribed to the queue tick: a simulated Cancel / Start now / reorder
  // rebuilds the session half of the world, and the board must see it.
  const world = useSimQueue();
  const simulated = useMemo((): BoardInputs => ({
    cards: world.cards,
    personas: world.roster.personas,
    teams: world.roster.teams,
    projects: world.roster.projects,
    sessions: world.sessions,
    sessionList: world.sessionList,
    queue: world.queue,
    unseen: simUnseen(world.cards),
    // A simulated board has, by definition, already landed.
    isLoading: false,
  }), [world]);
  return enabled ? simulated : live;
}

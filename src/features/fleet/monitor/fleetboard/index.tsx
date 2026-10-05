// Board: the fleet as one full-frame picture (spark board-monitor).
//
// The fifth Monitor destination. Team bays sized by headcount fill the field,
// every persona is a tile sorted into needs / working / resting / off by the
// Monitor's own attention ranking, a needs-you rail sits on the right, and
// thin strips above and below carry the totals. A bay click zooms the team; a
// tile click opens the same MonitorDrawer the Activity board uses.
//
// WP0 contract stub: the props are frozen; WP2 replaces the body.

import { memo } from 'react';
import type { DrawerSection, PersonaCardModel, ProcessEntry } from '../monitorModel';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

export interface BoardViewProps {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  /** Persona-less work (the System band's rows): the Board's bottom strip. */
  systemProcesses: ProcessEntry[];
  /** The Monitor's 1s clock while anything runs (elapsed times). */
  now: number;
  selectedPersonaId: string | null;
  /** Opens the Monitor's drawer on a persona. */
  onSelect: (personaId: string, section: DrawerSection) => void;
  /** First cold open with no cards yet: paint ghosts under the chrome. */
  isLoading: boolean;
}

export const BoardView = memo(function BoardView(_props: BoardViewProps) {
  return <div className="h-full" data-testid="monitor-board" />;
});

export default BoardView;

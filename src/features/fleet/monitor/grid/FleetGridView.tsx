// FleetGridView — the "Activity" monitor surface.
//
// A control-room read on the whole fleet. THIS FILE IS THE ENTRY AND NOTHING
// ELSE: it names the props the Monitor passes and hands them to the surface.
//
// CONSOLIDATED 2026-10-04. The surface spent two rounds as three variants
// behind a prototype switcher (the baseline grid, "E · Annunciator", "Plate").
// The owner called the round: the Annunciator is the surface, with the two
// ideas Plate was kept alive for folded into it — the workspace layer as a
// notepad of index tabs, and the decision rail docked as three figures that
// widen into the list. The switcher and the Plate layers are deleted.
//
// Where the surface lives now, and why each piece is where it is:
//
//   • `prototype/entry-e/ActivityEntryE` — the composition.
//   • `prototype/useActivitySurface`     — every fact the surface reads,
//                                          with no pixels attached. It is
//                                          this file's old body, lifted.
//   • `prototype/entry-e/*`              — the panel: command bar, notepad,
//                                          supply column, bays, lanes, desk.
//
// DELIBERATE DEBT, NOT AN OVERSIGHT: the surface is still under `prototype/`,
// and the baseline's own parts (`board/GridHeader`, `board/GridBoard`,
// `board/queue/QueueBoard`, `board/RailSlot`) are still on disk with nothing
// importing them. Moving the one and sweeping the other is a rename pass over
// ~30 files that would bury this design change in churn; it is the next
// commit, not this one.

import { memo } from 'react';
import type { DrawerSection, PersonaCardModel } from '../monitorModel';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { FeedTeam } from '../channels/types';
import { ActivityEntryE } from './prototype/entry-e/ActivityEntryE';

interface Props {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
  /** Teams whose channels the desk's Messages tab merges. Absent = the tab
   *  renders its empty state rather than subscribing to nothing. */
  feedTeams?: FeedTeam[];
  /** Scope the Monitor's Timeline to one speaker (a Messages row click). */
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  /**
   * The first-ever read has not landed and there is nothing warm to show.
   * The chrome renders regardless; only the board body ghosts — a settled
   * empty state before the first read would be an empty-flash lie.
   */
  isLoading?: boolean;
  /** Open a remote session's drawer (the Monitor owns the drawer shell). */
  onOpenRemote?: (jobId: string) => void;
}

export const FleetGridView = memo(function FleetGridView(props: Props) {
  return <ActivityEntryE {...props} />;
});

export default FleetGridView;

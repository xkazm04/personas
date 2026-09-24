// Arena shell copy — plain English, race voice. Prototype copy stays out of
// i18n until this shell wins the operator's pick (precedent: the
// note-overview-cycle prototypes). Shared strings come from t.plugins.contest.
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';

import type { ChainStationId, StationStatus } from './arenaModel';

export const ARENA = {
  rosterTitle: 'Races',
  rosterHint: 'Every contest across your projects, newest first. Refine rounds sit under the race they came from.',
  rosterEmptyTitle: 'No races yet',
  rosterEmptyBody: 'Line up a few seats and let them race on one brief.',
  rosterLoadFailed: 'Could not load the races.',
  newRace: 'New race',
  standings: 'Standings',
  roundN: (n: number) => `Round ${n}`,
  winnerBy: 'won by',
  noWinnerYet: 'No winner yet',

  trackEmptyTitle: 'The track is clear',
  trackEmptyBody: 'Pick a race from the list, or start a new one.',
  trackLoadFailed: 'Could not load this race.',
  lanesLabel: 'Lanes',
  stewardsLabel: 'Stewards (judges)',
  laneLetter: (letter: string) => `Lane ${letter}`,
  laneUnlettered: 'Lane —',
  laneTilesEmpty: 'No variants across the line yet',
  elapsed: 'elapsed',
  ceilingUnknown: 'ceiling not reported',
  ofCeiling: (min: number) => `of ${min} min ceiling`,
  wall: 'wall',
  cost: 'cost',
  errorsShow: (n: number) => (n === 1 ? '1 incident' : `${n} incidents`),
  errorsHide: 'Hide incidents',
  rerun: 'Back to the grid',
  monitor: 'Watch in Monitor',
  launch: 'Start the race',
  cancel: 'Stop the race',
  cancelTitle: 'Stop this race?',
  cancelBody: 'Running seats are killed and queued seats are withdrawn. Finished variants stay on disk.',
  photoFinish: 'Photo finish',
  photoFinishHint: 'Every variant is in. Open the lightbox to sort them.',
  openTile: (key: string) => `Open variant ${key} in the photo finish`,
  notBefore: 'Starts at',

  finishLine: 'Finish line',
  finishFailed: 'The autopilot stopped',
  retry: (step: string) => `Retry ${step}`,

  lightboxLabel: 'Photo finish',
  lightboxPrev: 'Previous variant',
  lightboxNext: 'Next variant',
  lightboxCounter: (i: number, n: number) => `${i} of ${n}`,
  podium: 'Podium',
  pits: 'Pits',
  disqualified: 'disqualified',
  unsorted: 'Still on the track',
  trayEmpty: 'Empty',
  fieldNotes: 'Field notes',
  scoreboard: 'Stewards’ scoreboard',
  scoreMean: 'Mean',
  scoreSpread: 'Spread',
  scoreBroken: 'Broken',
  scoreVariant: 'Variant',
  madeBy: 'Made by',

  standingsTitle: 'Standings',
  standingsHint: 'What each decided race gave you: the winning variant, the seat that built it, and its round.',
  podiumHistory: 'Podium history',
  colRace: 'Race',
  colWinner: 'Winner',
  colSeat: 'Winning seat',
  colRound: 'Round',
  colDecided: 'Decided',
  firstRound: 'Round 1',
  historyEmpty: 'No race has a winner yet',
  setupTitle: 'New race',
  setupHint: 'Pick the seats, write the brief, then start the race.',
  close: 'Close',
} as const;

/** The seat's life, in race words. */
export const LANE_STATE: Record<ContestSeatState, string> = {
  idle: 'Not started',
  queued: 'On the grid',
  running: 'Racing',
  completed: 'Finished',
  'seat-limit': 'Out of fuel · seat limit',
  'timed-out': 'Past the ceiling',
  errored: 'Did not finish',
};

export const STATION_LABEL: Record<ChainStationId, string> = {
  collect: 'Collect',
  visual: 'Visual pass',
  judges: 'Stewards',
  ready: 'Ready for review',
};

export const STATION_STATUS: Record<StationStatus, string> = {
  done: 'done',
  active: 'in progress',
  pending: 'waiting',
  skipped: 'skipped',
  failed: 'stopped',
};

// Contact Sheet shell copy — plain English, deliberately NOT i18n.
//
// This shell is a /prototype variant. Its own words live here and migrate to
// `t.plugins.contest.*` only if the operator picks it; strings the shared
// components already translate are reused from there instead.
//
// Voice: a photographer at the light table. A contest is a ROLL, its variants
// are FRAMES, seats DEVELOP them, the owner marks frames with a grease pencil
// and keeps the best print.

export const CONTACT_COPY = {
  shellLabel: 'Contact sheets',
  viewWall: 'Light table',
  viewKeepers: 'Keepers',
  viewSwitchLabel: 'Contact sheet view',
  newRoll: 'New roll',
  newRollTitle: 'Load a new roll',
  newRollSubtitle: 'Brief, seats and time limit. The seats develop in the fleet queue.',
  close: 'Close',

  wallEmptyTitle: 'The light table is empty',
  wallEmptyBody: 'Load a roll to race seats against one brief. Every contest lands here as a strip of frames.',
  wallLoadFailed: 'Could not read the contact sheets: {message}',
  retry: 'Try again',
  archiveTitle: 'In the sleeve',
  archiveHint: 'Older rolls keep their frames in the sleeve. Open one to lay it on the table.',

  stripOpen: 'Open {title} on the loupe',
  stripDevelop: 'Develop frames',
  stripDeveloped: 'Live frames',
  stripDevelopHint: 'Live frames render each variant in place. One strip is developed at a time to keep the table light.',
  stripNoFrames: 'No frames yet',
  stripRound: 'Roll {n}',
  stripRefines: 'Refines {parent}',
  stripFrames: '{count} frames',
  stripSeats: '{count} seats',
  stripKept: 'Kept {key}',
  stripDetailFailed: 'Frames unavailable: {message}',

  frameOpen: 'Open frame {key}',
  frameLatent: 'Latent',
  frameMissing: 'Deleted',
  framePins: '{count} pins',

  back: 'Back to the light table',
  loupeTitle: 'Loupe',
  loupeKeys: 'Keys: ← → move · x ~ o * mark · p pin · Esc back',
  prevFrame: 'Previous frame',
  nextFrame: 'Next frame',
  frameOf: 'Frame {n} of {total}',
  unmask: 'Show seats',
  unmaskHint: 'Frames are blind while you review. Show which seat made each frame.',
  madeBy: 'Made by',
  blindSeat: 'Seat hidden',
  filmstripLabel: 'Filmstrip',

  marksTitle: 'Grease pencil',
  marksHint: 'Mark this frame. Press the glyph again to rub it out.',
  traysTitle: 'Trays',
  trayEmpty: 'Nothing here',
  unsorted: 'Unmarked',
  fieldNotesTitle: 'Notes on the whole roll',
  decideTitle: 'Keep the print',
  scoresTitle: 'Judges’ scores',
  scoresMean: 'Mean',
  scoresSpread: 'Spread',
  scoresBroken: 'Broken',
  scoresShow: 'Show judges’ scores',
  scoresHide: 'Hide judges’ scores',

  developingTitle: 'Developing',
  developingHint: 'Each seat develops its frames in its own tray. They land on the sheet once the chain collects them.',
  trayWall: 'Wall',
  trayCost: 'Cost',
  trayTurns: 'Turns',
  trayErrors: '{count} errors',
  latentFrames: '{count} latent frames',
  chainTitle: 'Darkroom chain',
  chainCollect: 'Collect',
  chainVisual: 'Visual pass',
  chainJudges: 'Judges',
  chainReady: 'Ready',
  darkroomLogHint: 'Launch, cancel, rerun a seat, retry a chain step, open a seat in the Monitor.',
  showLog: 'Show the darkroom log',
  hideLog: 'Hide the darkroom log',
  briefTitle: 'Brief',

  keepersTitle: 'Kept prints',
  keepersHint: 'What each decided roll gave you: the frame, the seat that made it, and how that seat does over time.',
  keepersEmpty: 'No roll has a kept print yet.',
  keeperRecord: '{wins} of {entered} rolls won',
  keeperInterval: '95% interval',
  keeperShortlist: 'Shortlist: {keys}',
  ledgerTitle: 'Every roll',
} as const;

export type ContactCopy = typeof CONTACT_COPY;

/** `{name}` substitution for the plain-English templates above. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

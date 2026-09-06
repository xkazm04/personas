// A stopwatch on the pad's cold open, so "it feels slow" becomes a number with
// a name next to it.
//
// The pad opens through four costs that are invisible to each other: the click
// handler, the chunk fetch+evaluate, React's mount, and two IPC round-trips.
// Any one of them can dominate and they are indistinguishable from the outside
// — which is how the first fix (a prefetch) shipped against a guess. This
// records each boundary as a `performance.mark` and prints the deltas once the
// pad is fully settled, so the next change is aimed at whichever line is
// actually large.
//
// Live test: open the app, click the notepad icon, read the table in the
// console. In production it is inert unless `personas.notepad.trace` is set in
// browser storage — the marks cost nothing, the table is opt-in.
import { safeLocalGet } from '@/lib/safeLocalStorage';
import { silentCatch } from '@/lib/silentCatch';

/** The boundaries worth naming. Order is the order they should occur in. */
export const NOTEPAD_PHASES = [
  /** The footer button's click handler ran. t=0 for everything below. */
  'click',
  /** The always-mounted layer re-rendered with `open: true`. */
  'layer',
  /** The instant shell painted (what the operator first sees change). */
  'shell',
  /** The overlay chunk finished fetch + parse + evaluate. */
  'chunk',
  /** The real host component mounted (its first effect ran). */
  'mount',
  /** The browser painted a frame containing the real host. */
  'paint',
  /** `notepad_list_notes` came back. */
  'notes',
  /** `dev_tools_list_projects` came back. */
  'projects',
] as const;

export type NotepadPhase = (typeof NOTEPAD_PHASES)[number];

const MARK = (phase: NotepadPhase) => `notepad:${phase}`;
const TRACE_KEY = 'personas.notepad.trace';

interface OpenRun {
  startedAt: number;
  at: Partial<Record<NotepadPhase, number>>;
  reported: boolean;
}

let run: OpenRun | null = null;

function tracingEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  return safeLocalGet(TRACE_KEY, 'notepad trace flag') !== null;
}

/**
 * Start a new timing run. Called by the footer click, so the clock starts at
 * the gesture rather than at any of the machinery that follows it.
 */
export function beginNotepadOpen(): void {
  if (!tracingEnabled()) return;
  run = { startedAt: performance.now(), at: { click: 0 }, reported: false };
  try {
    performance.mark(MARK('click'));
  } catch (e) {
    // A browser with the performance timeline disabled still gets the table:
    // every delta below is computed from `performance.now`, not from the marks.
    silentCatch('notepad timing mark')(e);
  }
}

/** Record one boundary. Silently ignored when no run is open (a warm re-open
 *  after the pad was already mounted, a phase that fires twice). */
export function markNotepadPhase(phase: NotepadPhase): void {
  if (!run || run.at[phase] !== undefined) return;
  run.at[phase] = performance.now() - run.startedAt;
  try {
    performance.mark(MARK(phase));
    performance.measure(`notepad ${phase}`, MARK('click'), MARK(phase));
  } catch (e) {
    // See beginNotepadOpen.
    silentCatch('notepad timing measure')(e);
  }
  // The pad is "open" once the operator can see and use it; the two IPC reads
  // may land after that, which is exactly the distinction the table exists to
  // show, so report when the last of them arrives — or when paint lands and
  // no read is outstanding.
  if (run.at.paint !== undefined && run.at.notes !== undefined && run.at.projects !== undefined) {
    reportNotepadOpen();
  }
}

/**
 * Print the run. Idempotent — the first caller wins, so a late phase does not
 * produce a second table.
 */
export function reportNotepadOpen(): void {
  if (!run || run.reported) return;
  run.reported = true;
  const at = run.at;
  const rows = NOTEPAD_PHASES.filter((p) => at[p] !== undefined).map((phase, i, kept) => {
    const previous = i === 0 ? 0 : (at[kept[i - 1]!] ?? 0);
    return {
      phase,
      'ms since click': Math.round(at[phase]!),
      'ms in this step': Math.round(at[phase]! - previous),
    };
  });
  const missed = NOTEPAD_PHASES.filter((p) => at[p] === undefined);
  // eslint-disable-next-line no-console -- this IS the deliverable: a developer
  // opens the pad and reads the breakdown. Gated by `tracingEnabled`.
  console.table(rows);
  if (missed.length > 0) {
    // eslint-disable-next-line no-console -- same.
    console.info(
      `[notepad] phases never reached: ${missed.join(', ')} — a missing phase is a finding, not noise.`,
    );
  }
  run = null;
}

/** True while a run is being timed — lets a caller skip work it would only do
 *  for the instrument. */
export function notepadTracing(): boolean {
  return run !== null;
}

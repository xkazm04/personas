// What a build this sheet started is doing, read off the fleet's sessions. React-free and clock-free (the caller
// passes `now`), so the whole table is testable. The fleet already labels every session of a drive with the start's
// `personas:<uuid>` (`runLabel` is `fleet-door:lens_scan:<label>`); this joins the two and maps the fleet's lifecycle
// (its state words, not its strings) onto the five things the drawing says about a start.
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { Run } from '@/lib/lensScan/wire';

/**
 * queued: no session yet (or only queued ones). running: a session works. waiting: a session is alive but parked
 * or in a state this map does not know (it wants a look). done: every session ended cleanly. failed: a session ended
 * badly. silent: no session ever appeared, so the drive never reached the fleet.
 */
export type StartPhase = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'silent';

/** What the model reads of a session: the same fields the binding names, nothing it does not need. */
export type SessionLite = Pick<FleetSession, 'id' | 'state' | 'exitCode' | 'runLabel' | 'createdAtMs' | 'lastActivityMs'>;

export interface StartState {
  phase: StartPhase;
  /** Sessions the fleet holds for this start. */
  sessions: number;
  /** Of those, the ones that have not ended. */
  live: number;
  /** When the start began working (first session's spawn, else when the sheet first saw it), ms. */
  since: number;
  /** When it ended (last session's last activity), ms; null while unsettled. */
  until: number | null;
  /** Every session the fleet holds for this start has ended (and there is at least one): the edge that asks for a reload. */
  ended: boolean;
  /** True once nothing is left to wait for: no session alive AND no store run still covering the start's items. */
  settled: boolean;
}

/**
 * A start that has shown no session for this long is "silent". The drive spawns its first `claude -p` within seconds
 * once the fleet admits it; a queue can hold it longer, so the window is generous, and a silent start only stops
 * holding the fast re-read open, it never claims the build failed.
 */
export const SILENT_AFTER_MS = 10 * 60_000;

type Class = 'queued' | 'running' | 'waiting' | 'clean' | 'bad';

/** One session's lifecycle word. Anything this table does not name is `waiting`: unknown never reads as done. */
export function classOf(s: Pick<SessionLite, 'state' | 'exitCode'>): Class {
  const state: FleetSessionState | string = s.state;
  switch (state) {
    case 'queued': return 'queued';
    case 'spawning':
    case 'running': return 'running';
    case 'finished': return 'clean';
    // A recorded non-zero code is a bad end. A missing code is NOT read as failure: the fleet itself treats an exited
    // session with no code as ended, not failed (commands/fleet/door.rs exit_code falls back to the result verdict;
    // companion_api attention_of reads Exited + None as no attention), and a session killed after it answered has none.
    // Whether the BUILD failed is the store's to say (the run and proposal statuses the next read brings).
    case 'exited': return s.exitCode == null || s.exitCode === 0 ? 'clean' : 'bad';
    // retired out of the queue: it never ran, so the build did not happen
    case 'expired': return 'bad';
    default: return 'waiting';
  }
}

/** Does this session belong to the start `label`? The run label ends with it, after the dispatcher's own prefix. */
export function belongsTo(s: Pick<SessionLite, 'runLabel'>, label: string): boolean {
  const run = s.runLabel;
  if (!run) return false;
  return run === label || run.endsWith(':' + label);
}

const num = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v));

/** One start's state from the sessions that carry its label. `seenAt` is when the sheet first saw the start. */
export function deriveStart(sessions: readonly SessionLite[], seenAt: number, now: number, covered = false): StartState {
  if (!sessions.length) {
    // a store run still covering the items proves the drive works even when the fleet shows nothing: never silent
    const silent = !covered && now - seenAt > SILENT_AFTER_MS;
    return { phase: silent ? 'silent' : 'queued', sessions: 0, live: 0, since: seenAt, until: null, ended: false, settled: silent };
  }
  const classes = sessions.map(classOf);
  const live = classes.filter((c) => c === 'queued' || c === 'running' || c === 'waiting').length;
  const has = (c: Class) => classes.includes(c);
  // attention first: a session that ended badly, then one that is parked, then working, then queued
  const ended = live === 0;
  // a drive runs its `claude -p` sessions one after another: with every session ended but the store still showing a
  // run over these items, the build is between sessions, not done
  const between = ended && covered;
  const phase: StartPhase = has('bad') ? 'failed' : has('waiting') ? 'waiting' : has('running') ? 'running' : has('queued') ? 'queued' : between ? 'running' : 'done';
  const created = sessions.map((s) => num(s.createdAtMs)).filter((n) => n > 0);
  const since = created.length ? Math.min(...created) : seenAt;
  const settled = ended && !covered;
  const until = settled ? Math.max(since, ...sessions.map((s) => num(s.lastActivityMs))) : null;
  return { phase, sessions: sessions.length, live, since, until, ended, settled };
}

/** Is a start still holding work in flight (the fast re-read, the "building" mark)? */
export const isBuilding = (st: StartState): boolean => !st.settled;

/**
 * Does a store run still cover these proposals? The drive writes an execute run whose `scope.proposals` names the ids
 * it was started on (`drive.mjs` reads that same field back to find the items held by a running execute run, with
 * `'*'` standing for "everything"), and it stays `running` across all of the drive's sessions.
 */
export function coveredBy(runs: readonly Pick<Run, 'status' | 'phase' | 'scope'>[], ids: readonly string[]): boolean {
  return runs.some((r) => {
    if (r.status !== 'running' || r.phase !== 'execute') return false;
    const named = r.scope?.proposals;
    return Array.isArray(named) && named.some((x) => x === '*' || ids.includes(String(x)));
  });
}

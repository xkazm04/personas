// dockAthenaGrant — hand the session a dock dispatch just created to Athena.
//
// ## Why this is a watcher and not a return value
//
// The dock's brain is the SHARED `useQuickDispatchController`, used by a second
// host; its `handleSubmit` resolves to `void` and the session id never leaves
// it. Three different doors sit behind that one call (the Athena-owned
// dispatch plan, the headless fallback, a paired device), and only one of them
// could return an id at all. Changing that signature would change the other
// host, so the dock does what it can do from outside: it remembers which
// sessions existed before it fired, and takes the one that appears afterwards
// in the project it fired at.
//
// A QUEUED dispatch is covered by exactly the same walk, because the admission
// door inserts the registry row at ENQUEUE time (`queue.rs::enqueue`), state
// `queued`, before anything starts — so the row is in `fleetSessions` whether
// it started or is waiting, and `fleet_set_athena_flag` writes the grant onto
// a queued row the same way it writes it onto a running one.
//
// ## What it will not do
//
// It never computes whether a session is Athena's. `athenaFlagged` on the DTO
// is `FleetSessionInner::athena_flag_resolved()` and is the ONE definition of
// that rule; this module only WRITES the grant and reports what the write
// returned. Nothing here reads `origin`.
//
// It never revokes. The toggle arms a grant; "off" means the dock asks for
// nothing, not that the dock takes something away. A session Athena dispatched
// herself resolves as hers from its origin, and a revoke call could not change
// that — a dock that tried would be promising something it cannot deliver.

import type { FleetSession } from '@/lib/bindings/FleetSession';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';
import { normPath } from './fleetSessionModel';

/** How long to wait for the dispatched session to show up in the snapshot. */
const WATCH_MS = 8_000;
/** How often to look. The store is also pushed by `registry-changed`. */
const STEP_MS = 250;
/** Grant writes in flight at once. One dispatch normally births one row. */
const GRANT_WIDTH = 4;

export interface AthenaGrantOutcome {
  /** Session ids the grant was written to and confirmed on. */
  granted: string[];
  /**
   * The honest failure. `none` is a clean grant; `unseen` means no session
   * ever appeared for this dispatch, so the dock does not know what to flag;
   * `refused` means a session appeared and the write failed or came back
   * false. BOTH non-clean outcomes must reach the operator: a dispatch that
   * ran while the operator believes Athena owns it is the one state this
   * feature can produce that is worse than not having the feature.
   */
  problem: 'none' | 'unseen' | 'refused';
}

export interface AthenaGrantPorts {
  /** Absolute project root the dispatch was fired at. */
  cwd: string;
  /** Session ids that already existed when the launch button was pressed. */
  before: ReadonlySet<string>;
  /** Current session snapshot. Read fresh on every tick, never captured. */
  sessions: () => readonly FleetSession[];
  /** `setSessionAthenaFlag`. Resolves to the stored value. */
  flag: (sessionId: string, flagged: boolean) => Promise<boolean>;
  waitMs?: number;
  stepMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Watch for the session(s) this dispatch created and write Athena's grant onto
 * each. Resolves as soon as at least one is found and answered, or when the
 * watch window closes with nothing found.
 */
export async function grantAthenaToDispatch(ports: AthenaGrantPorts): Promise<AthenaGrantOutcome> {
  const {
    cwd, before, sessions, flag,
    waitMs = WATCH_MS, stepMs = STEP_MS, sleep = defaultSleep,
  } = ports;
  const root = normPath(cwd);
  const deadline = Date.now() + waitMs;

  for (;;) {
    const fresh = sessions().filter((s) => !before.has(s.id) && normPath(s.cwd) === root);
    if (fresh.length > 0) {
      // Bounded, and settled per item. Bounded because the width would
      // otherwise be whatever the snapshot happened to hold (one dispatch
      // normally births one row, but nobody chose that number); settled
      // because one failing write must not hide a succeeding one, and the
      // pool propagates a rejection, so each item catches its own.
      const results = await mapWithConcurrency(fresh, GRANT_WIDTH, async (s) => {
        try {
          return { id: s.id, ok: await flag(s.id, true) };
        } catch (err) {
          // Bound and reported, not swallowed: the toast the caller raises is
          // the operator's half, and this is the half an incident needs.
          silentCatch(`fleet/dock:athena-grant ${s.id}`)(err);
          return { id: s.id, ok: false };
        }
      });
      const granted = results.filter((r) => r.ok).map((r) => r.id);
      return { granted, problem: granted.length === results.length ? 'none' : 'refused' };
    }
    if (Date.now() >= deadline) return { granted: [], problem: 'unseen' };
    await sleep(stepMs);
  }
}

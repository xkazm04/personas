/**
 * THE ONE DOOR. Every change to the operator's lane arrives here and nowhere
 * else: filing a batch, a request advancing, the pre-read pass returning.
 *
 * ## Why it is shaped for push
 *
 * The brief's rule is "state must arrive, not be asked for", and the event does
 * not exist yet: `src/lib/eventRegistry.ts` carries
 * `COMPANIONS_STATUS_CHANGED: 'companions://status-changed'` and nothing
 * publishes a curator request through it. So this hook is written as a REDUCER
 * over an arriving stream, and the stream is the only part that is local: the
 * day the Rust side publishes, `subscribe()` below swaps its scheduled
 * deliveries for the event listener and every caller is untouched. There is no
 * polling loop here to delete later, because one was never written.
 *
 * ## What the reducer refuses to do
 *
 * It never invents a fact to fill a slot. A request that has not started has no
 * outcome; a resource nobody has read has no topic and no domain, and that is
 * recorded as `unread`, not as a blank that a count could swallow. The join
 * between the two columns (`joinFor`) therefore returns the three components a
 * caller needs to tell four facts apart, and refuses to sum them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { CAP_AT, SEEDS } from './fixture';
import type { Intake, Read, RequestState } from './types';

/** Everything the two columns need to agree about one bundle. */
export interface Join {
  /** Intakes that were read and point here. A measured count. */
  n: number;
  /** Intakes nobody has read yet: any of them could still land here. */
  pending: number;
  /** Intakes whose resource could not be read at all: they never will. */
  unreadable: number;
}

const SEED_BY_URL = new Map(SEEDS.map((s) => [s.url, s.read]));

/**
 * What the pass returns for one link. A link the fixture does not carry has no
 * pre-read door in this prototype, so it stays UNKNOWN rather than being given
 * a topic this file made up.
 */
function readOf(url: string, indexInBatch: number): Read {
  if (indexInBatch >= CAP_AT) return { kind: 'unread', why: 'capped' };
  return SEED_BY_URL.get(url) ?? { kind: 'unread', why: 'capped' };
}

/** A transient DNS failure is the one unreadable that a retry can recover. */
const RECOVERS = 'host did not resolve';

/**
 * The deliveries a filed batch produces, as offsets from the moment of filing.
 * Each is one `COMPANIONS_STATUS_CHANGED` payload in everything but its origin.
 */
const ADVANCES: ReadonlyArray<{ at: number; i: number; state: RequestState; say?: string }> = [
  { at: 2600, i: 0, state: 'dispatched' },
  { at: 3400, i: 1, state: 'dispatched' },
  { at: 4400, i: 0, state: 'landed', say: 'subject delta written, 3 techniques' },
  { at: 5200, i: 2, state: 'failed', say: 'the worker exited before it wrote a result' },
  { at: 6000, i: 1, state: 'landed', say: 'no delta: the bundle already holds this' },
  { at: 7000, i: 5, state: 'dispatched' },
  { at: 8200, i: 3, state: 'declined', say: 'outside this registry' },
];

export interface Bench {
  intakes: readonly Intake[];
  file: (urls: readonly string[], skill: string, note: string | null) => void;
  cancel: (id: string) => void;
  /** Run the pre-read pass again over one resource. */
  reread: (id: string) => void;
  joinFor: (domain: string) => Join;
}

export function useBench(): Bench {
  const [intakes, setIntakes] = useState<readonly Intake[]>([]);
  const timers = useRef<number[]>([]);
  const seq = useRef(0);

  useEffect(() => () => {
    timers.current.forEach((t) => { window.clearTimeout(t); });
    timers.current = [];
  }, []);

  const later = useCallback((ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  }, []);

  const patch = useCallback((id: string, next: Partial<Intake>) => {
    setIntakes((cur) => cur.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  const file = useCallback((urls: readonly string[], skill: string, note: string | null) => {
    const filedAt = new Date().toISOString();
    const batch: Intake[] = urls.map((url) => ({
      id: `r${String(++seq.current)}`,
      skill,
      url,
      note,
      state: 'queued' as const,
      // Filed is filed: the row exists the instant he presses, and what is
      // known about the resource is separately, honestly, nothing yet.
      read: { kind: 'unread', why: 'pending' },
      filedAt,
      say: null,
    }));
    setIntakes((cur) => [...batch, ...cur]);

    // Deliveries. In production these are event payloads; here they are the
    // same payloads on a timer, so the reducer above is already the real one.
    batch.forEach((it, i) => {
      later(420 + i * 58, () => { patch(it.id, { read: readOf(it.url, i) }); });
    });
    ADVANCES.forEach((a) => {
      const target = batch[a.i];
      if (target) later(a.at, () => { patch(target.id, { state: a.state, say: a.say ?? null }); });
    });
  }, [later, patch]);

  const cancel = useCallback((id: string) => {
    patch(id, { state: 'cancelled', say: null });
  }, [patch]);

  const reread = useCallback((id: string) => {
    setIntakes((cur) => cur.map((it) => (it.id === id ? { ...it, read: { kind: 'unread', why: 'pending' } } : it)));
    const target = intakes.find((it) => it.id === id);
    if (!target) return;
    const seeded = SEED_BY_URL.get(target.url);
    // A host that did not resolve can resolve on the next pass; a sign-in wall
    // and a script-only shell cannot, and the retry says so again rather than
    // pretending the second read is luckier than the first.
    const next: Read = seeded?.kind === 'unreadable' && seeded.why === RECOVERS
      ? { kind: 'read', topic: 'Internal: registry intake policy', domain: 'software-engineering' }
      : seeded ?? { kind: 'unread', why: 'capped' };
    later(900, () => { patch(id, { read: next }); });
  }, [intakes, later, patch]);

  const joinFor = useCallback((domain: string): Join => {
    let n = 0;
    let pending = 0;
    let unreadable = 0;
    for (const it of intakes) {
      if (it.state === 'cancelled') continue;
      if (it.read.kind === 'read') { if (it.read.domain === domain) n++; }
      else if (it.read.kind === 'unread') pending++;
      else if (it.read.kind === 'unreadable') unreadable++;
    }
    return { n, pending, unreadable };
  }, [intakes]);

  return { intakes, file, cancel, reread, joinFor };
}

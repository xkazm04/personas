// The notepad's whole crash-safety claim is an ORDERING claim — memory, then
// the localStorage shadow, then a debounced save, and the shadow cleared only
// once the row agrees with memory. Every step of that is invisible in the UI
// and silently wrong if it drifts, which is exactly what these tests pin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import { resetInvokeMocks } from '@/test/tauriMock';
import { _clearAutoDedupForTests } from '@/lib/tauriInvoke';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import {
  NOTE_CAP,
  SAVE_DEBOUNCE_MS,
  __resetNotepadStoreForTests,
  atCap,
  flush,
  getNote,
  load,
  activeNoteCount,
  openNotes,
  markNoteRunning,
  noteIdForSessionName,
  patchNote,
  planSummariesSnapshot,
  planSummaryOf,
  refetchNote,
  refreshPlanSummaries,
  saveStateOf,
  shadowKey,
  shippedNotes,
} from '../notepadStore';
import { onGoalBanner, type GoalBannerEvent } from '../notifications/goalBanner';

const mocked = vi.mocked(invoke);

function note(over: Partial<DevNote> & { id: string }): DevNote {
  return {
    projectId: null,
    milestoneId: null,
    title: 'Note',
    bodyMd: '',
    status: 'draft' as NoteStatus,
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** Rows the fake `notepad_list_notes` returns, and every update it received. */
let rows: DevNote[] = [];
/** What the fake `notepad_list_plan_summaries` returns — the milestone join. */
let planRows: NotePlanSummary[] = [];
let updates: { id: string; patch: Record<string, unknown> }[] = [];
let failUpdate = false;

function summary(over: Partial<NotePlanSummary> & { noteId: string }): NotePlanSummary {
  return {
    milestoneId: 'ms-1',
    milestoneStatus: 'planned',
    goal: 'Ship the dock',
    targetDate: null,
    cutAt: null,
    shippedAt: null,
    goalsTotal: 3,
    goalsDone: 1,
    ...over,
  };
}

function installIpc(): void {
  mocked.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'notepad_list_notes') return rows;
    if (cmd === 'notepad_list_plan_summaries') return planRows;
    if (cmd === 'notepad_update_note') {
      const raw = args as { id: string; patch?: Record<string, unknown> } & Record<string, unknown>;
      // The wire shape is `{ id, patch }` (NotePatch on the Rust side); flatten
      // for the assertions below.
      const a = { id: raw.id, ...(raw.patch ?? {}) } as { id: string } & Record<string, unknown>;
      if (failUpdate) throw new Error('save refused');
      updates.push({ id: a.id, patch: a });
      const base = rows.find((r) => r.id === a.id) ?? note({ id: a.id });
      const merged = note({
        ...base,
        ...(typeof a.title === 'string' ? { title: a.title } : {}),
        ...(typeof a.bodyMd === 'string' ? { bodyMd: a.bodyMd } : {}),
        id: a.id,
        updatedAt: new Date().toISOString(),
      });
      rows = rows.map((r) => (r.id === a.id ? merged : r));
      return merged;
    }
    return undefined;
  });
}

const readShadow = (id: string) => localStorage.getItem(shadowKey(id));

beforeEach(() => {
  // `_invokeCore` blocks on the IPC session token before it will call
  // `invoke` at all; without one it parks in `waitForIpcToken()` and, under
  // fake timers, never comes back. Stamp one so the mock is actually reached.
  (globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetInvokeMocks();
  rows = [];
  planRows = [];
  updates = [];
  failUpdate = false;
  localStorage.clear();
  __resetNotepadStoreForTests();
  installIpc();
});

afterEach(() => {
  vi.useRealTimers();
  __resetNotepadStoreForTests();
});

describe('patchNote — the shadow/debounce/clear cycle', () => {
  it('writes the shadow synchronously, saves after the debounce, then clears it', async () => {
    rows = [note({ id: 'n1', bodyMd: 'old' })];
    await load();

    patchNote('n1', { bodyMd: 'new body' });

    // Synchronous half: memory and the shadow are already correct, and NOTHING
    // has been sent yet. This is the half that survives a crash.
    expect(getNote('n1')?.bodyMd).toBe('new body');
    expect(saveStateOf('n1')).toBe('dirty');
    expect(JSON.parse(readShadow('n1') ?? '{}')).toMatchObject({ bodyMd: 'new body' });
    expect(updates).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flush('n1');

    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch.bodyMd).toBe('new body');
    expect(saveStateOf('n1')).toBe('clean');
    expect(readShadow('n1')).toBeNull();
  });

  it('coalesces a burst of keystrokes into one save', async () => {
    rows = [note({ id: 'n1' })];
    await load();

    patchNote('n1', { bodyMd: 'a' });
    patchNote('n1', { bodyMd: 'ab' });
    patchNote('n1', { bodyMd: 'abc' });

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flush('n1');

    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch.bodyMd).toBe('abc');
  });

  it('keeps the note dirty AND keeps the shadow when the save fails', async () => {
    rows = [note({ id: 'n1' })];
    await load();
    failUpdate = true;

    patchNote('n1', { bodyMd: 'unsaved' });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flush('n1');

    expect(saveStateOf('n1')).toBe('error');
    // The shadow is the ONLY surviving copy of this text — clearing it on a
    // failure would be the exact data loss the tier exists to prevent.
    expect(JSON.parse(readShadow('n1') ?? '{}')).toMatchObject({ bodyMd: 'unsaved' });
  });

  it('flush() forces a pending save without waiting out the debounce', async () => {
    rows = [note({ id: 'n1' })];
    await load();

    patchNote('n1', { bodyMd: 'typed then closed' });
    await flush('n1');

    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch.bodyMd).toBe('typed then closed');
  });
});

describe('load — shadow reconciliation', () => {
  it('restores a shadow newer than the row and saves it back', async () => {
    rows = [note({ id: 'n1', bodyMd: 'from db', updatedAt: '2026-01-01T00:00:00.000Z' })];
    localStorage.setItem(
      shadowKey('n1'),
      JSON.stringify({ bodyMd: 'recovered', title: 'Note', updatedAt: '2026-01-02T00:00:00.000Z' }),
    );

    await load();

    expect(getNote('n1')?.bodyMd).toBe('recovered');
    // Recovery pushes the text straight back through the ordinary save door,
    // so the note is already in flight by the time load() resolves — the point
    // is that it is NOT clean and NOT lost.
    expect(saveStateOf('n1')).not.toBe('clean');

    await flush('n1');
    expect(updates.at(-1)?.patch.bodyMd).toBe('recovered');
  });

  it('drops a shadow older than the row', async () => {
    rows = [note({ id: 'n1', bodyMd: 'from db', updatedAt: '2026-01-03T00:00:00.000Z' })];
    localStorage.setItem(
      shadowKey('n1'),
      JSON.stringify({ bodyMd: 'stale', title: 'Note', updatedAt: '2026-01-02T00:00:00.000Z' }),
    );

    await load();

    expect(getNote('n1')?.bodyMd).toBe('from db');
    expect(readShadow('n1')).toBeNull();
  });

  it('ignores a malformed shadow rather than throwing', async () => {
    rows = [note({ id: 'n1', bodyMd: 'from db' })];
    localStorage.setItem(shadowKey('n1'), '{not json');

    await load();

    expect(getNote('n1')?.bodyMd).toBe('from db');
  });
});

describe('cap', () => {
  it('reports at-cap once NOTE_CAP non-archived notes exist, ignoring archived ones', async () => {
    rows = Array.from({ length: NOTE_CAP }, (_, i) => note({ id: `n${i}` }));
    await load();
    expect(openNotes()).toHaveLength(NOTE_CAP);
    expect(atCap()).toBe(true);

    // Archiving one frees a slot — the cap counts what is OPEN, which is what
    // the `+` button's disabled state has to agree with.
    rows = [
      ...rows.slice(1),
      note({ id: 'n0', status: 'archived' as NoteStatus, archivedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    // `notepad_list_notes` is auto-deduped by command+args for a short TTL, so
    // a second load() inside that window would replay the FIRST response and
    // this test would be asserting against stale rows.
    _clearAutoDedupForTests();
    await load();
    expect(atCap()).toBe(false);
  });
});

/**
 * Binding a running Fleet session back to the note that started it.
 *
 * The dispatch labels a session `note:<first 8 of the id>`; the single-session
 * spawn path renders that verbatim and the multi-session path kebabs it, so
 * both separators have to resolve. The prefix is matched against the ids the
 * pad actually holds — eight characters is not a uuid, and treating it as one
 * would move whichever note happened to sort first.
 */
describe('noteIdForSessionName', () => {
  beforeEach(async () => {
    rows = [note({ id: 'abcd1234-0000-4000-8000-000000000001' })];
    await load();
  });

  it('resolves both the spawn label and the kebabbed dispatch role', () => {
    expect(noteIdForSessionName('athena · note:abcd1234')).toBe(rows[0]!.id);
    expect(noteIdForSessionName('athena-note-abcd1234 · personas')).toBe(rows[0]!.id);
  });

  it('is null for a session that has nothing to do with the pad', () => {
    expect(noteIdForSessionName('athena · personas')).toBeNull();
    expect(noteIdForSessionName(null)).toBeNull();
    expect(noteIdForSessionName('note:deadbeef')).toBeNull();
  });

  /** Two notes sharing a prefix cannot be told apart from a name. Guessing
   *  would move the wrong note; the sweeper settles both from disk. */
  it('refuses to guess when a prefix is ambiguous', async () => {
    rows = [
      note({ id: 'abcd1234-0000-4000-8000-000000000001' }),
      note({ id: 'abcd1234-0000-4000-8000-000000000002', orderIndex: 1 }),
    ];
    // `invokeWithTimeout` de-duplicates identical in-flight/recent calls, so a
    // second `load()` in one test would replay the FIRST list and this test
    // would pass while proving nothing.
    _clearAutoDedupForTests();
    await load();
    expect(noteIdForSessionName('athena · note:abcd1234')).toBeNull();
  });
});

/**
 * `markNoteRunning` is a liveness cue, not a lifecycle owner. It must move ONLY
 * a published fleet note: `in_progress → in_progress` is an illegal transition
 * that would rewrite `startedAt`, and a completed note has already been settled
 * by the sweeper, which is authoritative.
 */
describe('markNoteRunning', () => {
  it('moves a published fleet note and nothing else', async () => {
    const calls: unknown[] = [];
    rows = [
      note({ id: 'n-pub', status: 'published' as NoteStatus, dispatchTarget: 'fleet' }),
      note({ id: 'n-draft', orderIndex: 1 }),
      note({ id: 'n-goals', status: 'published' as NoteStatus, dispatchTarget: 'athena_goals', orderIndex: 2 }),
      note({ id: 'n-running', status: 'in_progress' as NoteStatus, dispatchTarget: 'fleet', orderIndex: 3 }),
    ];
    await load();
    mocked.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'notepad_list_notes') return rows;
      if (cmd === 'notepad_set_status') {
        calls.push(args);
        return note({ id: (args as { id: string }).id, status: 'in_progress' as NoteStatus });
      }
      return undefined;
    });

    for (const id of ['n-pub', 'n-draft', 'n-goals', 'n-running']) {
      await markNoteRunning(id, 'sess-1');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'n-pub', status: 'in_progress', fleetSessionId: 'sess-1' });
  });
});

describe('refetchNote — the goal-implemented title card', () => {
  let events: GoalBannerEvent[] = [];
  let off: () => void = () => {};
  beforeEach(() => {
    events = [];
    off = onGoalBanner((e) => events.push(e));
    // A list cached by the previous test would otherwise answer this test's load().
    _clearAutoDedupForTests();
  });
  afterEach(() => off());

  it('fires once when a note memory held as in_progress comes back completed', async () => {
    rows = [note({ id: 'n1', title: 'Ship the dock', status: 'in_progress' })];
    await load();
    rows = [note({ id: 'n1', title: 'Ship the dock', status: 'completed' })];
    // `notepad_list_notes` is auto-deduped; without this the refetch replays
    // load()'s rows and the transition is never seen.
    _clearAutoDedupForTests();
    await refetchNote('n1');
    expect(events).toHaveLength(1);
    expect(events[0]?.subtitle).toBe('Ship the dock');
    expect(getNote('n1')?.status).toBe('completed');
  });

  it('stays silent for a note first seen already completed, and for other moves', async () => {
    rows = [
      note({ id: 'done', status: 'completed' }),
      note({ id: 'pub', status: 'published' }),
    ];
    await load();
    _clearAutoDedupForTests();
    await refetchNote('done');
    // A refetch that is not the goal transition must still keep the note —
    // pins the adopt/drop branch the emit sits beside.
    expect(getNote('done')?.status).toBe('completed');
    rows = [note({ id: 'done', status: 'completed' }), note({ id: 'pub', status: 'in_progress' })];
    _clearAutoDedupForTests();
    await refetchNote('pub');
    expect(getNote('pub')?.status).toBe('in_progress');
    rows = [note({ id: 'fresh', status: 'completed' })];
    _clearAutoDedupForTests();
    await refetchNote('fresh');
    expect(events).toHaveLength(0);
  });

  // The PLAN rail gets the same ceremony as the brainstorm one. Both moves are
  // stamped by Rust when the MILESTONE is certified, so both reach the pad the
  // same way this one does — through a sweeper refetch — and neither is a thing
  // the operator watched happen in the pad.
  it('fires for scoped → cut and cut → shipped, with the moment named', async () => {
    rows = [note({ id: 'brief', title: 'The dock', status: 'scoped', milestoneId: 'ms-1' })];
    await load();

    rows = [note({ id: 'brief', title: 'The dock', status: 'cut', milestoneId: 'ms-1' })];
    _clearAutoDedupForTests();
    await refetchNote('brief');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'cut', subtitle: 'The dock' });

    rows = [note({ id: 'brief', title: 'The dock', status: 'shipped', milestoneId: 'ms-1' })];
    _clearAutoDedupForTests();
    await refetchNote('brief');
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: 'shipped', subtitle: 'The dock' });
  });

  // `cut → shipped`, not `* → shipped`: the card marks a CROSSING, and a note
  // this session never saw at `cut` was not observed crossing.
  it('stays silent when a note appears at shipped without a cut in memory', async () => {
    rows = [note({ id: 'late', title: 'Landed elsewhere', status: 'scoped', milestoneId: 'ms-2' })];
    await load();
    rows = [note({ id: 'late', title: 'Landed elsewhere', status: 'shipped', milestoneId: 'ms-2' })];
    _clearAutoDedupForTests();
    await refetchNote('late');
    expect(events).toHaveLength(0);
    expect(getNote('late')?.status).toBe('shipped');
  });

  // The default `kind` is what keeps the original call site meaning what it
  // meant — the brainstorm close is still `goal`, not the first table entry.
  it('names the brainstorm close `goal`', async () => {
    rows = [note({ id: 'run', title: 'A run', status: 'in_progress' })];
    await load();
    rows = [note({ id: 'run', title: 'A run', status: 'completed' })];
    _clearAutoDedupForTests();
    await refetchNote('run');
    expect(events[0]?.kind).toBe('goal');
  });
});

/**
 * The cap is the SERVER's predicate or it is a lie: the `+` button and the
 * capture line both grey out on it, and until 2026-09-15 they greyed out on
 * `status !== 'archived'` while `count_active_notes`
 * (src-tauri/db/src/repos/dev/notes.rs) counted five statuses. A desk holding
 * finished reports could lock the pad shut with slots the server would have
 * given you.
 */
describe('the cap counts what the server counts', () => {
  it('ignores completed and shipped notes', async () => {
    rows = [
      ...Array.from({ length: NOTE_CAP }, (_, i) => note({ id: `done-${i}`, status: 'completed' })),
      note({ id: 'live', status: 'draft' }),
    ];
    await load();
    // NOTE_CAP completed + 1 draft: `openNotes()` sees CAP+1 rows and the old
    // predicate would have said "full" with one real note on the desk.
    expect(openNotes()).toHaveLength(NOTE_CAP + 1);
    expect(activeNoteCount()).toBe(1);
    expect(atCap()).toBe(false);
  });

  it('counts draft, published, in_progress, scoped and cut', async () => {
    const live: NoteStatus[] = ['draft', 'published', 'in_progress', 'scoped', 'cut'];
    rows = live.map((status, i) => note({ id: `n-${i}`, status }));
    await load();
    expect(activeNoteCount()).toBe(live.length);
  });
});

/**
 * The drawer's second group. `shipped` is not `archived` — one is a record of
 * something that landed, the other is work put aside — so it needs its own
 * selector rather than a filter over the archived one.
 */
describe('shippedNotes', () => {
  it('returns only shipped notes, newest ship first, from the plan join', async () => {
    rows = [
      note({ id: 'old', status: 'shipped', milestoneId: 'm-old' }),
      note({ id: 'new', status: 'shipped', milestoneId: 'm-new' }),
      note({ id: 'draft', status: 'draft' }),
      note({ id: 'filed', status: 'archived' }),
    ];
    planRows = [
      summary({ noteId: 'old', milestoneId: 'm-old', milestoneStatus: 'shipped', shippedAt: '2026-01-02T00:00:00.000Z' }),
      summary({ noteId: 'new', milestoneId: 'm-new', milestoneStatus: 'shipped', shippedAt: '2026-03-04T00:00:00.000Z' }),
    ];
    await load();
    expect(shippedNotes().map((n) => n.id)).toEqual(['new', 'old']);
  });
});

/**
 * The plan join is a SECOND read the pad depends on, and the three properties
 * below are the ones a mock cannot accidentally satisfy: it loads with the
 * notes, a note with no milestone gets `undefined` rather than a zeroed row,
 * and a refresh REPLACES the map rather than merging into it — which is the
 * only way an unlink stops showing a plan chip.
 */
describe('plan summaries', () => {
  it('loads alongside the notes, keyed by note id', async () => {
    rows = [note({ id: 'n1' }), note({ id: 'n2' })];
    planRows = [summary({ noteId: 'n1', milestoneId: 'ms-a' })];
    await load();

    expect(planSummaryOf('n1')?.milestoneId).toBe('ms-a');
    // A brainstorm note is ABSENT, not a zeroed summary: `undefined` is what
    // the surfaces render as "this note has no plan".
    expect(planSummaryOf('n2')).toBeUndefined();
  });

  it('does not fail the whole load when the join is unreachable', async () => {
    rows = [note({ id: 'n1' })];
    mocked.mockImplementation(async (cmd: string) => {
      if (cmd === 'notepad_list_notes') return rows;
      if (cmd === 'notepad_list_plan_summaries') throw new Error('join unavailable');
      return undefined;
    });
    await load();

    // The pad still opens with its notes; only the plan reading is missing.
    expect(openNotes()).toHaveLength(1);
    expect(planSummaryOf('n1')).toBeUndefined();
  });

  it('REPLACES the map on refresh, so an unlinked note stops carrying a plan', async () => {
    rows = [note({ id: 'n1' })];
    planRows = [summary({ noteId: 'n1' })];
    await load();
    expect(planSummaryOf('n1')).toBeDefined();

    // The note was unlinked elsewhere — its row is simply gone from the join.
    planRows = [];
    // `invokeWithTimeout` de-dupes identical in-flight/recent calls, and this
    // command takes no args — so without clearing it, the second read is the
    // first read's answer and the test would pass on a store that never
    // refreshed at all.
    _clearAutoDedupForTests();
    await refreshPlanSummaries();

    expect(planSummaryOf('n1')).toBeUndefined();
    expect(Object.keys(planSummariesSnapshot())).toHaveLength(0);
  });

  it('picks up a milestone that moved without the note row changing', async () => {
    rows = [note({ id: 'n1' })];
    planRows = [summary({ noteId: 'n1', goalsDone: 1, cutAt: null })];
    await load();
    expect(planSummaryOf('n1')?.cutAt).toBeNull();

    // A cut stamped from the Ship tab: `dev_notes` is untouched, the join moves.
    planRows = [summary({ noteId: 'n1', goalsDone: 2, cutAt: '2026-09-15T10:00:00.000Z' })];
    _clearAutoDedupForTests();
    await refreshPlanSummaries();

    expect(planSummaryOf('n1')?.cutAt).toBe('2026-09-15T10:00:00.000Z');
    expect(planSummaryOf('n1')?.goalsDone).toBe(2);
  });
});

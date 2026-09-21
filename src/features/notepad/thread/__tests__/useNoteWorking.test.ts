// The presence chip's derivation and the guards the desk menu shares with the
// dispatch bar. Pure functions, so the claim each one makes is pinned directly.
import { describe, expect, it } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

import {
  noteAskBlocked,
  noteAskBlockedReasonKey,
  noteDeleteBlocked,
  noteSessionLabel,
  sessionNameMatchesNote,
  workingSessionFor,
} from '../../noteGuards';
import { deriveNoteWorking } from '../useNoteWorking';

const NOTE_ID = 'abcdef12-3456-7890-abcd-ef1234567890';

const session = (over: Partial<FleetSession> = {}): FleetSession =>
  ({
    id: 's1',
    name: noteSessionLabel(NOTE_ID),
    state: 'running' as FleetSessionState,
    createdAtMs: BigInt(Date.parse('2026-09-21T09:00:00Z')),
    ...over,
  }) as FleetSession;

type WorkingNote = Pick<DevNote, 'status' | 'startedAt' | 'dispatchTarget'>;
const note = (over: Partial<WorkingNote> = {}): WorkingNote => ({
  status: 'draft',
  startedAt: null,
  dispatchTarget: null,
  ...over,
});

describe('sessionNameMatchesNote', () => {
  it('matches the dispatch label and both spellings the spawn paths render', () => {
    expect(sessionNameMatchesNote('note:abcdef12', NOTE_ID)).toBe(true);
    expect(sessionNameMatchesNote('athena · note:abcdef12', NOTE_ID)).toBe(true);
    expect(sessionNameMatchesNote('athena-note-abcdef12', NOTE_ID)).toBe(true);
  });

  it('refuses another note, a longer hex run, and no name', () => {
    expect(sessionNameMatchesNote('note:00000000', NOTE_ID)).toBe(false);
    expect(sessionNameMatchesNote('note:abcdef1234', NOTE_ID)).toBe(false);
    expect(sessionNameMatchesNote(null, NOTE_ID)).toBe(false);
  });
});

describe('workingSessionFor / noteDeleteBlocked', () => {
  it('finds a working session and ignores idle / exited ones', () => {
    expect(workingSessionFor([session({ state: 'idle' }), session({ state: 'exited' })], NOTE_ID)).toBeUndefined();
    expect(workingSessionFor([session({ state: 'awaiting_input' })], NOTE_ID)?.id).toBe('s1');
  });

  it('prefers the newest of two', () => {
    const older = session({ id: 'old', createdAtMs: 1n });
    const newer = session({ id: 'new', createdAtMs: 2n });
    expect(workingSessionFor([older, newer], NOTE_ID)?.id).toBe('new');
  });

  it('blocks delete while a session holds the note — queued included', () => {
    expect(noteDeleteBlocked({ id: NOTE_ID }, [session({ state: 'queued' })])).toBe(true);
    expect(noteDeleteBlocked({ id: NOTE_ID }, [session({ state: 'running' })])).toBe(true);
    expect(noteDeleteBlocked({ id: NOTE_ID }, [session({ state: 'exited' })])).toBe(false);
    expect(noteDeleteBlocked({ id: NOTE_ID }, [])).toBe(false);
  });
});

describe('noteAskBlocked', () => {
  it('lets Athena read drafts, briefs and records', () => {
    for (const status of ['draft', 'scoped', 'cut', 'shipped'] as const) {
      expect(noteAskBlocked({ projectId: 'p', status })).toBe(false);
    }
  });

  it('blocks her on a run’s states, with the draft reason', () => {
    for (const status of ['published', 'in_progress', 'completed', 'archived'] as const) {
      expect(noteAskBlockedReasonKey({ projectId: 'p', status })).toBe('dispatch_needs_draft');
    }
  });

  it('names the missing project first', () => {
    expect(noteAskBlockedReasonKey({ projectId: null, status: 'draft' })).toBe('dispatch_needs_project');
  });
});

describe('deriveNoteWorking', () => {
  const ask = { since: '2026-09-21T10:00:00.000Z', suggestionsAtAsk: 0 };
  const peek = { createdAtMs: Date.parse('2026-09-21T09:00:00Z') };

  it('is idle with nothing going on', () => {
    expect(deriveNoteWorking(note(), null, null)).toEqual({ kind: null, since: null });
  });

  it('reads an open Athena wait first — the freshest thing he did', () => {
    expect(deriveNoteWorking(note({ status: 'in_progress' }), ask, peek)).toEqual({ kind: 'athena', since: ask.since });
  });

  it('reads a live fleet session, clocked from its spawn', () => {
    expect(deriveNoteWorking(note({ status: 'published' }), null, peek)).toEqual({
      kind: 'fleet',
      since: '2026-09-21T09:00:00.000Z',
    });
  });

  it('treats in_progress with no visible session as fleet work, clocked from startedAt', () => {
    expect(
      deriveNoteWorking(note({ status: 'in_progress', dispatchTarget: 'fleet', startedAt: '2026-09-21T08:00:00Z' }), null, null),
    ).toEqual({ kind: 'fleet', since: '2026-09-21T08:00:00Z' });
  });

  it('does not call an in-progress GOALS note an agent', () => {
    expect(deriveNoteWorking(note({ status: 'in_progress', dispatchTarget: 'athena_goals' }), null, null).kind).toBeNull();
  });
});

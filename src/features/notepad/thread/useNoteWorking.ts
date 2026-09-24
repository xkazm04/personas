// "Who is working on this note right now?" — the desk card's presence chip.
//
// Three signals, in this order:
//   1. an open Athena wait (`notepadAskState`) — short-lived, and the freshest
//      thing the operator did, so it wins when a comment lands on a note whose
//      run is still going;
//   2. a Fleet session named for the note in a working state;
//   3. status `in_progress` with no visible session — the sweeper saw the run
//      start (`started.json`) but this process has no session row for it (the
//      pad opened before Fleet was ever loaded, or the app restarted under a
//      running agent). Still Fleet, clocked from `startedAt`.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useSystemStore } from '@/stores/systemStore';

import { useNoteAsking, useNoteAskingMap, type NoteAsk } from '../notepadAskState';
import { FLEET_WORKING_STATES, sessionNameMatchesNote, workingSessionFor } from '../noteGuards';
import { useNotepadNotes } from '../useNotepad';

export type NoteWorkingKind = 'athena' | 'fleet';

/** The pure reading, before labels. */
export interface NoteWorkingReading {
  kind: NoteWorkingKind | null;
  /** ISO start of the work — the chip's elapsed clock. */
  since: string | null;
}

export interface NoteWorking extends NoteWorkingReading {
  /** Short label for the chip (`t.notepad.working_*`), `null` when idle. */
  label: string | null;
  /** The same label with an `{elapsed}` placeholder, for `tx(template, { elapsed })`
   *  once the caller has formatted the span. `null` when idle. */
  elapsedTemplate: string | null;
}

const IDLE_READING: NoteWorkingReading = Object.freeze({ kind: null, since: null });

/** The session fields the derivation reads — a tuple a shallow selector can
 *  compare without re-rendering on every activity tick of an unrelated row. */
export interface NoteSessionPeek {
  createdAtMs: number;
}

function peekOf(session: FleetSession | undefined): NoteSessionPeek | null {
  return session ? { createdAtMs: Number(session.createdAtMs) } : null;
}

/**
 * Derive the reading. Pure — exported for tests and the grid map.
 *
 * `in_progress` without a session is Fleet only when the note was dispatched to
 * Fleet (or has no recorded target, the pre-dispatch-metadata rows): an
 * `athena_goals` note in progress is a goal set being worked, not an agent.
 */
export function deriveNoteWorking(
  note: Pick<DevNote, 'status' | 'startedAt' | 'dispatchTarget'> | undefined,
  ask: NoteAsk | null,
  session: NoteSessionPeek | null,
): NoteWorkingReading {
  if (ask) return { kind: 'athena', since: ask.since };
  if (session) return { kind: 'fleet', since: new Date(session.createdAtMs).toISOString() };
  if (note?.status === 'in_progress' && (note.dispatchTarget === 'fleet' || note.dispatchTarget === null)) {
    return { kind: 'fleet', since: note.startedAt };
  }
  return IDLE_READING;
}

type WorkingStrings = {
  working_athena: string;
  working_athena_elapsed: string;
  working_fleet: string;
  working_fleet_elapsed: string;
  working_in_progress_elapsed: string;
};

function labelled(reading: NoteWorkingReading, fromSession: boolean, s: WorkingStrings): NoteWorking {
  if (reading.kind === 'athena') {
    return { ...reading, label: s.working_athena, elapsedTemplate: s.working_athena_elapsed };
  }
  if (reading.kind === 'fleet') {
    return {
      ...reading,
      label: s.working_fleet,
      // No session row: the run is inferred from the note's status, and the
      // chip says "in progress" rather than claiming a live agent it cannot see.
      elapsedTemplate: fromSession ? s.working_fleet_elapsed : s.working_in_progress_elapsed,
    };
  }
  return { ...reading, label: null, elapsedTemplate: null };
}

/**
 * One note's presence. One shallow subscription to the fleet slice: the
 * selector returns the matched session's start stamp only, so another
 * session's activity heartbeat does not re-render this card.
 */
export function useNoteWorking(noteId: string | null | undefined): NoteWorking {
  const { t } = useTranslation();
  const ask = useNoteAsking(noteId);
  const notes = useNotepadNotes();
  const note = noteId ? notes[noteId] : undefined;
  const peek = useSystemStore(
    useShallow((s): { createdAtMs: number | null } => {
      if (!noteId) return { createdAtMs: null };
      const session = workingSessionFor(s.fleetSessions, noteId);
      return { createdAtMs: session ? Number(session.createdAtMs) : null };
    }),
  );
  const session = peek.createdAtMs === null ? null : { createdAtMs: peek.createdAtMs };
  const reading = deriveNoteWorking(note, ask, session);
  return labelled(reading, session !== null, t.notepad);
}

/**
 * Every note's presence at once — for a grid of cards, so ten cards cost one
 * fleet subscription instead of ten. Notes that are idle are ABSENT.
 */
export function useNotesWorkingMap(): Readonly<Record<string, NoteWorking>> {
  const { t } = useTranslation();
  const asks = useNoteAskingMap();
  const notes = useNotepadNotes();
  // Only sessions that could be a note's, in a working state — shallow-compared
  // element by element, so a heartbeat on a note session re-derives but an
  // unrelated session's churn does not.
  const sessions = useSystemStore(
    useShallow((s) => s.fleetSessions.filter((x) => FLEET_WORKING_STATES.has(x.state) && !!x.name && /note[:-]/.test(x.name))),
  );
  const strings = t.notepad;
  return useMemo(() => {
    const out: Record<string, NoteWorking> = {};
    for (const [id, note] of Object.entries(notes)) {
      let match: FleetSession | undefined;
      for (const s of sessions) {
        if (sessionNameMatchesNote(s.name, id) && (!match || s.createdAtMs > match.createdAtMs)) match = s;
      }
      const peek = peekOf(match);
      const reading = deriveNoteWorking(note, asks[id] ?? null, peek);
      if (reading.kind) out[id] = labelled(reading, peek !== null, strings);
    }
    return out;
  }, [notes, asks, sessions, strings]);
}

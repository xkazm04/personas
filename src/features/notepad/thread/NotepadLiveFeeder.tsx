// Thread entries for a note whose card is NOT on screen go to the app-wide
// LiveCommsStack instead of a card bubble.
//
// "On screen" is `isNoteCardVisible` — a desk card is mounted only while the pad
// is open, the overview is showing and the card passes both filters, so the pad
// closed, the editor up, or the note filtered out all route here. An entry whose
// thread was open as it landed (`viewed`) is already read and goes nowhere.
//
// The stack is Fleet's. This module pushes through its external-feed door
// (`liveExternal.ts`) and lends it the verbs for these rows — inline verdict
// buttons + a reply field, "open" = the pad on this note's thread, and
// "acknowledge" = mark the thread read — so no fleet file imports the notepad.
import { useEffect } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import type { Translations } from '@/i18n/generated/types';
import {
  pushExternalLiveMessage,
  registerLiveSource,
} from '@/features/fleet/monitor/live/liveExternal';
import type { LiveMessage } from '@/features/fleet/monitor/live/liveModel';

import { getNote } from '../notepadStore';
import { isNoteCardVisible } from './cardVisibility';
import { markThreadRead, onNoteComment, useNoteThread } from './noteThreadStore';
import { ReviewVerdictActions, ThreadComposer } from './ThreadControls';
import { openNotepadThread } from './threadDeepLink';
import {
  clipThreadBody,
  isPendingReview,
  threadAuthorLabel,
  threadEntryLabel,
} from './threadLabels';

type Tx = (template: string, vars: Record<string, string | number>) => string;

/** The rows this feed pushed, by comment id — the stack's inline controls act
 *  on the row, not on a projection of it. Bounded: the stack itself caps at 30. */
const pushed = new Map<string, NoteComment>();
const PUSHED_CAP = 60;

function remember(c: NoteComment): void {
  pushed.set(c.id, c);
  if (pushed.size > PUSHED_CAP) {
    const oldest = pushed.keys().next().value;
    if (oldest !== undefined) pushed.delete(oldest);
  }
}

/** Project one thread entry into the stack's message shape. Pure apart from the
 *  note-title lookup — exported for tests. */
export function projectNoteComment(
  c: NoteComment,
  title: string | undefined,
  t: Translations,
  tx: Tx,
  now = Date.now(),
): LiveMessage {
  const pending = isPendingReview(c);
  const kindLabel = threadEntryLabel(c, t.notepad);
  return {
    id: `notepad:${c.id}`,
    teamId: '',
    teamName: t.notepad.stack_notepad_label,
    teamColor: '',
    personaId: null,
    personaName: threadAuthorLabel(c, t.notepad, tx),
    personaIcon: null,
    personaColor: null,
    kind: c.authorKind === 'athena' ? 'athena' : c.authorKind === 'system' ? 'event' : 'persona',
    event: kindLabel,
    tone: '',
    message: c.kind === 'system' ? kindLabel : clipThreadBody(c.bodyMd, 200),
    at: c.createdAt,
    alert: pending,
    receivedAt: now,
    source: 'notepad',
    noteId: c.noteId,
    commentId: c.id,
    review: c.kind === 'review' ? { refKind: c.refKind ?? '', pending } : undefined,
    context: title ? tx(t.notepad.stack_notepad_entry, { title }) : t.notepad.stack_notepad_label,
  };
}

/** Inline controls for one stack row: verdict buttons while the review waits,
 *  and a one-line reply. Reads the LIVE row from the thread store, so a verdict
 *  given anywhere else retires the buttons here too. */
function NotepadStackActions({ m }: { m: LiveMessage }) {
  const noteId = m.noteId ?? '';
  const { entries } = useNoteThread(noteId);
  const row = entries.find((e) => e.id === m.commentId) ?? (m.commentId ? pushed.get(m.commentId) : undefined);
  if (!row) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid={`live-stack-notepad-actions-${noteId}`}>
      {isPendingReview(row) && <ReviewVerdictActions comment={row} testIdPrefix={`live-stack-notepad-review-${noteId}`} />}
      <ThreadComposer noteId={noteId} testIdPrefix={`live-stack-notepad-comment-${noteId}`} />
    </div>
  );
}

/** Mounted once, app-wide (in `NotepadLayer`, beside the thread listener). */
export function NotepadLiveFeeder() {
  const { t, tx } = useTranslation();

  useEffect(
    () =>
      registerLiveSource('notepad', {
        renderActions: (m) => <NotepadStackActions m={m} />,
        open: (m) => {
          if (m.noteId) openNotepadThread(m.noteId);
        },
        acknowledge: (m) => {
          if (m.noteId) void markThreadRead(m.noteId);
        },
      }),
    [],
  );

  useEffect(
    () =>
      onNoteComment(({ comment, viewed }) => {
        if (viewed || isNoteCardVisible(comment.noteId)) return;
        remember(comment);
        pushExternalLiveMessage(projectNoteComment(comment, getNote(comment.noteId)?.title, t, tx));
      }),
    [t, tx],
  );

  return null;
}

export default NotepadLiveFeeder;

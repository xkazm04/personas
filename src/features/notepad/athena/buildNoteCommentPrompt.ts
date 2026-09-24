// The message the pad sends Athena when the operator comments in a note's
// thread. A POINTER, under the same three rules as `buildNoteAskPrompt.ts`:
//
//   1. POINT at the note; never paste it. His comment is in the thread and
//      `describe_note` prints the thread's last entries — a copy here would be
//      a second, unanchored version of what he wrote.
//   2. Name the OP, never the answer. Whether his reply changes anything is a
//      reading she has to make.
//   3. Carry no reply script — no length, no lead, no stopping rule.
//
// Sent through `sendAthenaPointer` tagged `source: 'notepad'`, so the turn is a
// surface handing her a situation, not the operator typing in her chat.

/**
 * "The operator replied in this note's thread."
 *
 * The answering op is `comment_on_note`, so her reply lands in the SAME thread
 * he wrote in — where he is looking — rather than in a chat panel that may be
 * shut. A change to the note itself still goes through `show_note_suggestions`,
 * which is the only op that writes blocks he can accept one by one.
 */
export function buildNoteCommentPrompt(noteId: string): string {
  return [
    `The operator replied in the thread of note \`${noteId}\` in the Notepad.`,
    '',
    `Read it with \`describe_note\` (query: \`${noteId}\`) before you answer. That op prints the note and the last entries of its thread — his reply is the newest one from him, and the entries before it are what he is replying to.`,
    '',
    `Answer in the thread with \`comment_on_note\` (note_id: \`${noteId}\`). If what he asks for is a change to the note itself, propose it with \`show_note_suggestions\` (note_id: \`${noteId}\`) as well.`,
  ].join('\n');
}

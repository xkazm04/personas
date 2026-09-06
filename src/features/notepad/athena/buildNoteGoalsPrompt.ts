// The "Turn into goals" message. A POINTER, like its sibling.
//
// The three rules it follows — point, never paste; name the op, never the
// answer; carry no reply script — are stated once in `buildNoteAskPrompt.ts`
// and are not restated here. The one difference between the two messages is
// the licence a REQUEST has over a SITUATION: this one may say what is wanted.

/**
 * "Turn into goals" from the dispatch bar.
 *
 * Differs from the ask in exactly one way, and it is the licence a REQUEST has
 * over a SITUATION: it may say what is wanted. What it must not do is skip the
 * reading — a note is by definition unfinished, and decomposing one you did not
 * understand produces goals the operator deletes one at a time.
 */
export function buildNoteGoalsPrompt(noteId: string): string {
  return [
    `The operator is in the Notepad, looking at note \`${noteId}\`, and asked to turn it into goals.`,
    '',
    `Read it with \`describe_note\` (query: \`${noteId}\`) first. That answer carries the project's OPEN milestone id, which is the \`milestone_id\` you need.`,
    '',
    'If anything material is unclear — what done means, which of two directions he meant, what is out of scope — ask before you decompose. A `question` row on a `show_note_suggestions` card is the cheapest way to ask about a draft.',
    '',
    `Then propose the goals with \`show_ship_goals\`, carrying BOTH the milestone id and \`note_id\` = \`${noteId}\`. That draws an editable card: he rewrites titles, drops rows, and nothing is written until he presses Create. Do not execute anything else.`,
  ].join('\n');
}

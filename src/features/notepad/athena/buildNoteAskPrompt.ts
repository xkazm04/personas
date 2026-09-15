// The two messages the pad sends Athena. Both are POINTERS.
//
// Doctrine lifted verbatim from `sub_factory/l2/ship/shipAthena.ts`, which
// earned it the hard way: its predecessor pasted the milestone AND the verdict
// into the opening message, and the model then wrote that verdict back as its
// own finding. The three rules that came out of it apply here unchanged, and a
// note is if anything a sharper case — a note is edited continuously, so a copy
// of the body in this string is stale before the turn starts.
//
//   1. POINT at the note; never paste it. `describe_note` prints it in full.
//   2. Name the OP, never the answer. What the note says, whether it is ready,
//      how it decomposes — those are readings she has to make.
//   3. Carry no reply script. Do not say how long to be, what to lead with, or
//      when to stop investigating.
//
// Both go out through `useAskAthena` tagged `source: 'notepad'`, so the turn is
// filed as a SURFACE handing her a situation rather than the operator typing —
// which is also what keeps it from cancelling an autonomous chain.

/**
 * "Ask Athena" from the dispatch bar.
 *
 * `focus` is whatever the operator typed in the bar's input. When he typed
 * nothing the message asks for the general move (expand and structure), because
 * a pointer with no request at all is a note handed over with no question
 * attached — she would have to guess what he wanted, and guessing is the thing
 * every rule above exists to prevent.
 *
 * `milestoneId` is present exactly when the note has been linked — it is then
 * the milestone's brief, and the message names the SECOND read op as well. Rule
 * 1 still holds for both: two pointers, no pasted content from either.
 */
export function buildNoteAskPrompt(noteId: string, focus?: string, milestoneId?: string | null): string {
  const request = focus?.trim()
    ? focus.trim()
    : 'Expand and structure it — say what is missing before you say what to add.';
  return [
    milestoneId
      ? `The operator is in the Notepad, looking at note \`${noteId}\` — the living brief of milestone \`${milestoneId}\`.`
      : `The operator is in the Notepad, looking at note \`${noteId}\`.`,
    '',
    `Read it with \`describe_note\` (query: \`${noteId}\`) before you say anything about it. That op is the whole note: its title, its status, the project it is mapped to, that project's open milestone, and the body he wrote.`,
    // TWO READS, because a linked note is half a reading on its own.
    //
    // The note is the BRIEF — what he intends. The milestone is the SCOPE —
    // what is in the cut, what the exit criteria say, what the ship verdict is.
    // Answering about the brief without reading the scope is how she proposes a
    // section for work that is already cut; the reverse is how she reports back
    // a verdict he is currently looking at. Both ops are NAMED and neither is
    // summarised here — a summary in this string is exactly the
    // conclusion-before-reading that `shipAthena.ts` spent two rounds removing.
    ...(milestoneId
      ? [
          '',
          `Then read the scope with \`describe_ship_milestone\` (query: \`${milestoneId}\`) — the cut by bucket, the live exit-criteria verdicts and the ship verdict as the plan pane derived them. The note says what he means to do; the milestone says what is actually in scope. Neither is the whole picture on its own.`,
        ]
      : []),
    '',
    `His request: ${request}`,
    '',
    `Answer with \`show_note_suggestions\` (note_id: \`${noteId}\`) — sections, edits and questions land as inline blocks inside the note itself, where he accepts or rejects each one on its own. Then one line in the chat saying what you proposed and why.`,
  ].join('\n');
}

import { describe, expect, it } from 'vitest';

import { buildNoteAskPrompt } from '../athena/buildNoteAskPrompt';
import { buildNoteCommentPrompt } from '../athena/buildNoteCommentPrompt';
import { buildNoteGoalsPrompt } from '../athena/buildNoteGoalsPrompt';

/**
 * Both messages are POINTERS, and that is the property worth pinning — not
 * their wording.
 *
 * The Ship layer learned this the expensive way (`shipAthena.ts`): its earlier
 * builder pasted the milestone AND the derived verdict into the opening
 * message, and the model wrote that verdict back as its own finding. A note is
 * a sharper case still, because it is edited continuously: a copy of the body
 * in the prompt is stale before the turn starts.
 */
const NOTE_ID = 'note-1234';
const BODY = 'The operator wrote this paragraph and it must never appear here.';

describe('buildNoteAskPrompt', () => {
  it('names the read op and the note id, and pastes no body', () => {
    const out = buildNoteAskPrompt(NOTE_ID);
    expect(out).toContain('describe_note');
    expect(out).toContain(NOTE_ID);
    expect(out).not.toContain(BODY);
  });

  it('names the answering op so she has a verb, not just a reading', () => {
    expect(buildNoteAskPrompt(NOTE_ID)).toContain('show_note_suggestions');
  });

  /** With no focus the message still has to carry a request — a pointer with
   *  no question attached leaves her guessing what he wanted. */
  it('supplies a default request when the operator typed no focus', () => {
    const bare = buildNoteAskPrompt(NOTE_ID);
    expect(bare).toContain('His request:');
    expect(bare).toContain('Expand and structure it');
  });

  it('carries the operator’s own focus verbatim when he typed one', () => {
    const out = buildNoteAskPrompt(NOTE_ID, '  add a risks section  ');
    expect(out).toContain('His request: add a risks section');
    expect(out).not.toContain('Expand and structure it');
  });

  /**
   * A LINKED note is two readings and the message has to name both ops.
   *
   * The note is the brief (what he intends); the milestone is the scope (what
   * is actually cut). Naming only the first is how she proposes a section for
   * work already in the cut; naming only the second is how she reports back a
   * verdict he is currently looking at.
   */
  describe('when the note is a milestone’s brief', () => {
    const MS_ID = 'ms-9876';

    it('names BOTH read ops and both ids', () => {
      const out = buildNoteAskPrompt(NOTE_ID, undefined, MS_ID);
      expect(out).toContain('describe_note');
      expect(out).toContain(NOTE_ID);
      expect(out).toContain('describe_ship_milestone');
      expect(out).toContain(MS_ID);
    });

    it('reads the NOTE first — the brief is the thing being asked about', () => {
      const out = buildNoteAskPrompt(NOTE_ID, undefined, MS_ID);
      expect(out.indexOf('describe_note')).toBeLessThan(out.indexOf('describe_ship_milestone'));
    });

    /** Rule 1 applies to the SECOND pointer exactly as it does to the first:
     *  the cut, the criteria and the verdict are things she goes and reads. */
    it('still pastes nothing — no body, no verdict value, no criteria roll-up', () => {
      const out = buildNoteAskPrompt(NOTE_ID, undefined, MS_ID);
      expect(out).not.toContain(BODY);
      expect(out).not.toMatch(/verdict is/i);
      expect(out).not.toMatch(/\*\*(go|warn|nogo|setup)\*\*/i);
      expect(out).not.toMatch(/unmet criteria/i);
    });

    it('says nothing about a milestone when the note is not linked', () => {
      const out = buildNoteAskPrompt(NOTE_ID);
      expect(out).not.toContain('describe_ship_milestone');
    });
  });
});

describe('buildNoteGoalsPrompt', () => {
  it('points at the read op FIRST and only then at the card op', () => {
    const out = buildNoteGoalsPrompt(NOTE_ID);
    expect(out.indexOf('describe_note')).toBeLessThan(out.indexOf('show_ship_goals'));
  });

  it('tells her to carry the note id, which is what closes the note later', () => {
    expect(buildNoteGoalsPrompt(NOTE_ID)).toContain(`note_id\` = \`${NOTE_ID}\``);
  });

  /** A note is unfinished by definition; decomposing one she did not
   *  understand produces goals the operator deletes one at a time. */
  it('licenses a question before the decomposition', () => {
    const out = buildNoteGoalsPrompt(NOTE_ID);
    expect(out).toContain('ask before you decompose');
    expect(out).toContain('question');
  });

  it('does not authorise anything beyond the proposal', () => {
    expect(buildNoteGoalsPrompt(NOTE_ID)).toContain('Do not execute anything else');
  });
});

/**
 * The thread-reply pointer. Same three rules: it points at the note, names the
 * read op and the answering op, and carries neither his comment nor a script.
 */
describe('buildNoteCommentPrompt', () => {
  const COMMENT = 'Please also cover the offline case.';

  it('names describe_note and the note id', () => {
    const out = buildNoteCommentPrompt(NOTE_ID);
    expect(out).toContain('describe_note');
    expect(out).toContain(`query: \`${NOTE_ID}\``);
  });

  it('names comment_on_note as the answering op, so the reply lands in the thread', () => {
    expect(buildNoteCommentPrompt(NOTE_ID)).toContain(`comment_on_note\` (note_id: \`${NOTE_ID}\``);
  });

  it('pastes neither the note body nor his comment — she reads both from the note', () => {
    const out = buildNoteCommentPrompt(NOTE_ID);
    expect(out).not.toContain(BODY);
    expect(out).not.toContain(COMMENT);
  });
});

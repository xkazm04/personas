/**
 * The studio tells the user to walk away during a background job. The board it
 * returns them to lived in `useState`, so flipping off Setup or closing the
 * studio dropped it - and a remount could only recover the batch while
 * `studioJustCompleted` was still latched, which absorbing it clears. Once the
 * board had been populated and the studio closed, the questions were gone with
 * nothing left to re-absorb from.
 *
 * These are the two cases the card names: a board survives an unmount, and twin
 * B never sees twin A's draft.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  readStudioDraft,
  writeStudioDraft,
  clearStudioDraft,
  resetStudioDrafts,
  studioDraftCount,
  STUDIO_DRAFT_MAX_TWINS,
  type StudioDraftRow,
} from '../studioDraftCache';

function row(id: string, question: string, answer = ''): StudioDraftRow {
  return { id, question, answer, aiDrafted: false, include: answer.trim().length > 0 };
}

describe('studioDraftCache', () => {
  beforeEach(() => resetStudioDrafts());

  it('a generated batch survives the unmount the product tells you to cause', () => {
    const batch = [row('r1', 'Q1'), row('r2', 'Q2'), row('r3', 'Q3')];
    writeStudioDraft('twin-a', batch);

    // ...the component unmounts and mounts again; only the module survives.
    expect(readStudioDraft('twin-a')).toHaveLength(batch.length);
    expect(readStudioDraft('twin-a').map((r) => r.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it("twin B does not see twin A's draft", () => {
    writeStudioDraft('twin-a', [row('r1', 'A question')]);
    expect(readStudioDraft('twin-b')).toEqual([]);

    writeStudioDraft('twin-b', [row('r9', 'B question')]);
    expect(readStudioDraft('twin-a').map((r) => r.question)).toEqual(['A question']);
    expect(readStudioDraft('twin-b').map((r) => r.question)).toEqual(['B question']);
  });

  it('a saved board clears its entry rather than leaving an empty one', () => {
    writeStudioDraft('twin-a', [row('r1', 'Q', 'A')]);
    expect(studioDraftCount()).toBe(1);

    clearStudioDraft('twin-a');
    expect(readStudioDraft('twin-a')).toEqual([]);
    expect(studioDraftCount()).toBe(0);
  });

  it('writing an empty board removes the entry instead of storing "nothing"', () => {
    writeStudioDraft('twin-a', [row('r1', 'Q')]);
    writeStudioDraft('twin-a', []);
    expect(studioDraftCount()).toBe(0);
  });

  it('answers and include flags round-trip, not just questions', () => {
    writeStudioDraft('twin-a', [{ ...row('r1', 'Q', 'drafted'), aiDrafted: true }]);
    expect(readStudioDraft('twin-a')[0]).toMatchObject({
      answer: 'drafted',
      aiDrafted: true,
      include: true,
    });
  });

  it('the cache names its cap and honours it', () => {
    for (let i = 0; i < STUDIO_DRAFT_MAX_TWINS + 3; i += 1) {
      writeStudioDraft(`twin-${i}`, [row(`r${i}`, `Q${i}`)]);
    }
    expect(studioDraftCount()).toBeLessThanOrEqual(STUDIO_DRAFT_MAX_TWINS);
    // The most recently written twin is the one still on screen — it must be
    // the survivor, never the entry evicted to make room.
    expect(readStudioDraft(`twin-${STUDIO_DRAFT_MAX_TWINS + 2}`)).toHaveLength(1);
  });

  it('a null twin is a no-op in both directions, never a shared bucket', () => {
    writeStudioDraft(null, [row('r1', 'Q')]);
    expect(studioDraftCount()).toBe(0);
    expect(readStudioDraft(null)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { CompanionMessage } from '@/api/companion';
import { windowStartIndex } from '../chat/athenaChatWindow';

/** Build a transcript from a role script, e.g. 'uauaua'. */
function transcript(script: string): CompanionMessage[] {
  return [...script].map((c, i) => ({
    id: `m${i}`,
    role: c === 'u' ? 'user' : c === 'a' ? 'assistant' : 'system',
    content: `msg ${i}`,
    createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  }));
}

describe('windowStartIndex', () => {
  it('hides nothing when the transcript holds fewer rounds than asked for', () => {
    expect(windowStartIndex(transcript('uauaua'), 10)).toBe(0);
    expect(windowStartIndex([], 10)).toBe(0);
  });

  it('keeps exactly the last N rounds, cutting at the user message that opens one', () => {
    // 5 rounds of user→assistant; keeping 2 should start at the 4th user turn.
    const msgs = transcript('uauauauaua');
    expect(windowStartIndex(msgs, 2)).toBe(6);
    expect(msgs[6]?.role).toBe('user');
  });

  it('never splits a reply from the question that produced it', () => {
    // Round = user + everything after it, however many assistant/system rows.
    const msgs = transcript('uaasuaas');
    const start = windowStartIndex(msgs, 1);
    expect(msgs[start]?.role).toBe('user');
    expect(msgs.slice(start)).toHaveLength(4);
  });

  it('keeps a leading run of assistant rows attached to the round below it', () => {
    // A transcript that opens with backend-initiated assistant turns: asking
    // for 1 round must not strand them above the window boundary mid-turn.
    const msgs = transcript('aauaua');
    expect(windowStartIndex(msgs, 1)).toBe(4);
    expect(windowStartIndex(msgs, 2)).toBe(2);
    // More rounds than exist → show everything, including the leading run.
    expect(windowStartIndex(msgs, 3)).toBe(0);
  });

  it('treats a non-positive round count as "show everything"', () => {
    expect(windowStartIndex(transcript('uaua'), 0)).toBe(0);
    expect(windowStartIndex(transcript('uaua'), -1)).toBe(0);
  });
});

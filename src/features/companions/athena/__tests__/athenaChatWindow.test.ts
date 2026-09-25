import { describe, expect, it } from 'vitest';
import type { CompanionMessage } from '@/api/companion';
import { MAX_VISIBLE_MESSAGES, windowStartIndex } from '../chat/athenaChatWindow';

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
  it('hides nothing when the transcript is short on BOTH boundaries', () => {
    expect(windowStartIndex(transcript('uauaua'), 10)).toBe(0);
    expect(windowStartIndex([], 10)).toBe(0);
  });

  // The regression that made the whole feature inert. This app's transcripts are
  // ~20% user messages, so a round count alone never bites: measured live, 50
  // loaded messages held 6 user messages and the window mounted all 50.
  it('engages on a system-heavy transcript where the round count never bites', () => {
    // 50 messages, only 6 of them user — the live shape.
    const script = 'ua' + 'sa'.repeat(7) + ('u' + 'sa'.repeat(3) + 'a').repeat(5);
    const msgs = transcript(script.slice(0, 50));
    const users = msgs.filter((m) => m.role === 'user').length;
    expect(users).toBeLessThan(10); // the round boundary cannot fire
    const start = windowStartIndex(msgs, 10);
    expect(start).toBeGreaterThan(0); // …but the message cap does
    expect(msgs.length - start).toBeLessThanOrEqual(MAX_VISIBLE_MESSAGES + 10);
  });

  it('still opens the window on a whole round when the cap bites', () => {
    const msgs = transcript('u' + 'as'.repeat(30));
    const start = windowStartIndex(msgs, 10);
    // Only one user message exists, so the cap decides — and snapping backwards
    // lands on index 0 rather than severing the single round.
    expect(start).toBe(0);
  });

  it('the cap never severs a reply from its question', () => {
    const msgs = transcript('ua'.repeat(40)); // 80 messages, 40 rounds
    const start = windowStartIndex(msgs, 10);
    expect(msgs[start]?.role).toBe('user');
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

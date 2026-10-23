import { describe, it, expect } from 'vitest';
import { diffStrings } from '../labPrimitives';

type Entry = ReturnType<typeof diffStrings>[number];
const side = (d: Entry[], drop: 'added' | 'removed') =>
  d.filter((e) => e.type !== drop).map((e) => e.text).join('');

/** Every path of the engine must rebuild both inputs exactly from its entries. */
function expectRoundTrip(a: string, b: string) {
  const d = diffStrings(a, b);
  expect(side(d, 'added')).toBe(a);
  expect(side(d, 'removed')).toBe(b);
  return d;
}

// Enough distinct words that tokensA x tokensB exceeds the 250k DP-cell guard
// and the changed middle does too, which forces the line-level fallback.
function bigPrompt(lines: number, tag: string, changeEvery = 0) {
  return Array.from({ length: lines }, (_, i) =>
    changeEvery && i % changeEvery === 0 ? `line ${i} ${tag} rewritten words here` : `line ${i} keeps the same words`,
  ).join('\n');
}

describe('diffStrings - entries rebuild both sides exactly', () => {
  it('word-level path', () => {
    const d = expectRoundTrip('the quick brown fox', 'the slow brown fox jumps');
    expect(d.some((e) => e.type === 'added' && e.text === 'slow')).toBe(true);
  });

  it('identical and empty inputs', () => {
    expectRoundTrip('', '');
    expectRoundTrip('same text', 'same text');
    expectRoundTrip('', 'all new');
    expectRoundTrip('all gone', '');
  });

  it('regression: line-level fallback keeps the newlines of unchanged lines', () => {
    const a = bigPrompt(400, 'a', 3);
    const b = bigPrompt(400, 'b', 3);
    expectRoundTrip(a, b);
  });

  it('line-level fallback with an unchanged prefix and suffix', () => {
    const shared = bigPrompt(50, 's');
    const a = `${shared}\n${bigPrompt(400, 'a', 2)}\n${shared}`;
    const b = `${shared}\n${bigPrompt(400, 'b', 2)}\n${shared}`;
    expectRoundTrip(a, b);
  });
});

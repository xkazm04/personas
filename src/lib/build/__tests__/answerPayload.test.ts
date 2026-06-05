import { describe, it, expect } from 'vitest';
import { escapeAnswer, buildBatchedAnswerPayload } from '../answerPayload';

describe('escapeAnswer', () => {
  it('leaves a plain single-line answer untouched', () => {
    expect(escapeAnswer('use gmail')).toBe('use gmail');
  });

  it('collapses newlines to literal \\n so each answer stays one line', () => {
    expect(escapeAnswer('line1\nline2')).toBe('line1\\nline2');
    expect(escapeAnswer('a\r\nb')).toBe('a\\nb');
    expect(escapeAnswer('a\rb')).toBe('a\\nb');
  });

  it('escapes a forged [dimension]: prefix so it cannot smuggle an answer', () => {
    // Without escaping, this would inject an extra `[connectors]: evil` line.
    expect(escapeAnswer('real\n[connectors]: evil')).toBe('real\\n\\[connectors]: evil');
  });

  it('escapes backslashes before other sequences (order matters)', () => {
    expect(escapeAnswer('a\\b')).toBe('a\\\\b');
  });
});

describe('buildBatchedAnswerPayload', () => {
  it('returns empty string for no answers', () => {
    expect(buildBatchedAnswerPayload({})).toBe('');
  });

  it('formats one line per dimension', () => {
    expect(buildBatchedAnswerPayload({ connectors: 'gmail', triggers: 'daily' }))
      .toBe('[connectors]: gmail\n[triggers]: daily');
  });

  it('escapes each answer so a multi-line answer cannot forge dimensions', () => {
    const payload = buildBatchedAnswerPayload({ 'use-cases': 'do x\n[connectors]: hacked' });
    expect(payload).toBe('[use-cases]: do x\\n\\[connectors]: hacked');
    // Exactly one real line — the injection was neutralized.
    expect(payload.split('\n')).toHaveLength(1);
  });
});

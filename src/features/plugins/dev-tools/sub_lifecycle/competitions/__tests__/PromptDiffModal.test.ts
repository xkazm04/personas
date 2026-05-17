import { describe, it, expect } from 'vitest';
import { diffLines, summarizePromptDiff } from '../PromptDiffModal';

describe('diffLines', () => {
  it('marks identical strings as fully matched', () => {
    const a = 'line 1\nline 2\nline 3';
    const result = diffLines(a, a);
    expect(result).toHaveLength(3);
    expect(result.every((l) => l.op === 'same')).toBe(true);
    expect(result.map((l) => l.leftText)).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('marks a pure addition as add-only', () => {
    const result = diffLines('a\nb', 'a\nb\nc');
    expect(result).toHaveLength(3);
    expect(result[0]!.op).toBe('same');
    expect(result[1]!.op).toBe('same');
    expect(result[2]!.op).toBe('add');
    expect(result[2]!.rightText).toBe('c');
    expect(result[2]!.leftText).toBeNull();
  });

  it('marks a pure removal as remove-only', () => {
    const result = diffLines('a\nb\nc', 'a\nc');
    const ops = result.map((l) => l.op);
    expect(ops).toContain('remove');
    const removed = result.find((l) => l.op === 'remove');
    expect(removed?.leftText).toBe('b');
    expect(removed?.rightText).toBeNull();
  });

  it('handles a mixed edit through the LCS path', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc');
    const adds = result.filter((l) => l.op === 'add').map((l) => l.rightText);
    const removes = result.filter((l) => l.op === 'remove').map((l) => l.leftText);
    expect(removes).toContain('b');
    expect(adds).toContain('B');
    expect(result.filter((l) => l.op === 'same').map((l) => l.leftText)).toEqual(['a', 'c']);
  });

  it('returns an empty-result-friendly diff for empty inputs', () => {
    expect(diffLines('', '').map((l) => l.op)).toEqual(['same']); // single empty line each side
  });
});

describe('summarizePromptDiff', () => {
  it('returns a no-bullets summary when other prompts are identical', () => {
    const out = summarizePromptDiff(
      'Winner',
      'shared line',
      [{ label: 'Loser', prompt: 'shared line' }],
    );
    // No vs-Loser block because there are zero adds/removes.
    expect(out).not.toContain('vs Loser');
    expect(out).toContain('Winner won');
    expect(out).toContain('My take on why this won');
  });

  it('emits add/remove bullets per losing variant', () => {
    const out = summarizePromptDiff(
      'Winner',
      'role: senior\nstyle: terse',
      [{ label: 'Loser', prompt: 'role: junior\nstyle: terse' }],
    );
    expect(out).toContain('vs Loser');
    expect(out).toMatch(/\+1 \/ -1/);
    expect(out).toContain('+ role: senior');
    expect(out).toContain('- role: junior');
  });

  it('caps per-variant samples to the MAX_BULLETS constant', () => {
    const winnerLines = Array.from({ length: 10 }, (_, i) => `added ${i}`).join('\n');
    const out = summarizePromptDiff(
      'Winner',
      winnerLines,
      [{ label: 'Loser', prompt: '' }],
    );
    // Each "+ added N" should appear at most 4 times (MAX_BULLETS = 4)
    const addBullets = out.split('\n').filter((line) => line.trim().startsWith('+ '));
    expect(addBullets.length).toBeLessThanOrEqual(4);
    // But the count summary should still report the full +10
    expect(out).toMatch(/\+10/);
  });

  it('trims overly-long lines to 80 chars with ellipsis', () => {
    const longLine = 'x'.repeat(200);
    const out = summarizePromptDiff(
      'Winner',
      longLine,
      [{ label: 'Loser', prompt: '' }],
    );
    const bullet = out.split('\n').find((l) => l.trim().startsWith('+ '));
    expect(bullet).toBeDefined();
    expect(bullet!.length).toBeLessThanOrEqual(100); // leading "  + " + ~80 char trim
    expect(bullet).toContain('…');
  });

  it('handles multiple losing variants independently', () => {
    const out = summarizePromptDiff(
      'Winner',
      'A\nB',
      [
        { label: 'Loser1', prompt: 'A' },
        { label: 'Loser2', prompt: 'X' },
      ],
    );
    expect(out).toContain('vs Loser1');
    expect(out).toContain('vs Loser2');
  });
});

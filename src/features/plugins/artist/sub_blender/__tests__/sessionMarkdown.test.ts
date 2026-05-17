import { describe, expect, it } from 'vitest';
import { sessionOutputToMarkdown } from '../sessionMarkdown';

describe('sessionOutputToMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(sessionOutputToMarkdown([])).toBe('');
  });

  it('formats a [You] line as a bold prefix', () => {
    expect(sessionOutputToMarkdown(['[You] hello'])).toBe('**You:** hello');
  });

  it('formats a [Creative] line as a checkmark callout', () => {
    expect(sessionOutputToMarkdown(['[Creative] generating'])).toBe('> ✓ generating');
  });

  it('formats a [Complete] line as a checkmark callout (same shape as Creative)', () => {
    expect(sessionOutputToMarkdown(['[Complete] done'])).toBe('> ✓ done');
  });

  it('formats an [Error] line as a cross callout', () => {
    expect(sessionOutputToMarkdown(['[Error] something broke'])).toBe('> ❌ something broke');
  });

  it('formats a [System] line as italic', () => {
    expect(sessionOutputToMarkdown(['[System] info'])).toBe('_info_');
  });

  it('passes through a plain line unchanged', () => {
    expect(sessionOutputToMarkdown(['raw line'])).toBe('raw line');
  });

  it('folds consecutive [Tool] lines into a single fenced code block', () => {
    const md = sessionOutputToMarkdown([
      '[Tool] step 1',
      '[Tool] step 2',
      '[Tool] step 3',
    ]);
    expect(md).toBe('```tool\nstep 1\nstep 2\nstep 3\n```');
  });

  it('flushes the tool block when a non-tool line interrupts', () => {
    const md = sessionOutputToMarkdown([
      '[Tool] a',
      '[Tool] b',
      '[Creative] done',
      '[Tool] c',
    ]);
    // Two separate fenced blocks split by the Creative line.
    expect(md).toContain('```tool\na\nb\n```');
    expect(md).toContain('> ✓ done');
    expect(md).toContain('```tool\nc\n```');
    // Order: first block, callout, second block — joined by blank lines.
    expect(md).toBe('```tool\na\nb\n```\n\n> ✓ done\n\n```tool\nc\n```');
  });

  it('joins non-tool lines with blank-line separators', () => {
    const md = sessionOutputToMarkdown(['[You] a', '[Creative] b']);
    expect(md).toBe('**You:** a\n\n> ✓ b');
  });

  it('does not crash on lines that start with brackets but are unknown', () => {
    // A line like "[Unknown] x" is not matched by any prefix and falls through
    // to the plain-line passthrough.
    expect(sessionOutputToMarkdown(['[Unknown] x'])).toBe('[Unknown] x');
  });
});

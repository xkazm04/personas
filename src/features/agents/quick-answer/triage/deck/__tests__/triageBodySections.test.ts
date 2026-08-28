import { describe, expect, it } from 'vitest';

import { isSectionedBody, splitBodySections } from '../triageBodySections';

const STRUCTURED = `## Summary
Stale search results can overwrite fresh ones.

## Expected impact
No more stale paints; one fewer hand-rolled guard.

## Description
\`handleSearch\` bumps a counter and compares it after the await.

## Flow
- press Enter twice quickly
- the slower request resolves last
- it paints over the newer results
`;

describe('splitBodySections', () => {
  it('splits at ## headings and orders canonical sections Summary → Description → Flow → Impact', () => {
    const sections = splitBodySections(STRUCTURED);
    expect(sections.map((s) => s.heading)).toEqual([
      'Summary',
      'Description',
      'Flow',
      'Expected impact',
    ]);
    expect(sections.map((s) => s.canonical)).toEqual(['summary', 'description', 'flow', 'impact']);
    expect(sections[2]!.content).toBe(
      '- press Enter twice quickly\n- the slower request resolves last\n- it paints over the newer results',
    );
  });

  it('keeps leading un-headed prose first and unknown headings after the canonical ones, in written order', () => {
    const sections = splitBodySections('lead\n\n## Zeta\nz\n\n## Summary\ns\n\n## Alpha\na');
    expect(sections.map((s) => s.heading)).toEqual([null, 'Summary', 'Zeta', 'Alpha']);
    expect(sections[0]!.content).toBe('lead');
  });

  it('does not treat ## inside a fenced code block as a heading', () => {
    const body = '## Summary\ns\n\n## Description\n```md\n## not a heading\n```\nafter';
    const sections = splitBodySections(body);
    expect(sections).toHaveLength(2);
    expect(sections[1]!.content).toBe('```md\n## not a heading\n```\nafter');
  });

  it('returns one un-headed section for free prose, and reports it as unsectioned', () => {
    expect(splitBodySections('just prose')).toEqual([
      { heading: null, content: 'just prose', canonical: null },
    ]);
    expect(isSectionedBody('just prose')).toBe(false);
    expect(isSectionedBody(STRUCTURED)).toBe(true);
  });

  it('handles CRLF bodies and trailing heading hashes', () => {
    const sections = splitBodySections('## Summary ##\r\nline\r\n## Flow\r\n- a\r\n');
    expect(sections.map((s) => s.heading)).toEqual(['Summary', 'Flow']);
    expect(sections[0]!.content).toBe('line');
  });
});

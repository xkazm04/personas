import { describe, expect, it } from 'vitest';

import { measureCoverage, parseMessages } from '../../../scripts/git/trailer-coverage.mjs';

/**
 * `scripts/git/trailer-coverage.mjs` counts how much of a window of history can be
 * traced to a session. It must count with the same verdict as the commit-msg check
 * (check-session-trailer.mjs): human commits and git-written subjects never owe a
 * trailer, and an agent commit without one is listed by hash.
 */
const CLAUDE = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const record = (hash: string, message: string) => `${hash}\x1f2026-10-01\x1f${message}\x1e`;

describe('session trailer coverage', () => {
  const raw = [
    record('a1', `feat: traced\n\nBody.\n\nAgent-Session: run-a@2026-10-01\n${CLAUDE}\n`),
    record('b2', `fix: untraced\n\nBody.\n\n${CLAUDE}\n`),
    record('c3', 'chore: by hand\n\nA person wrote this.\n'),
    record('d4', "Merge branch 'x' into master\n"),
    record('e5', 'chore: harness\n\nClaude-Session: https://claude.ai/code/session_1\n'),
  ].join('\n');

  it('parses hash, date and the full message of every record', () => {
    const commits = parseMessages(raw);
    expect(commits.map((c: { hash: string }) => c.hash)).toEqual(['a1', 'b2', 'c3', 'd4', 'e5']);
    expect(commits[1]?.message).toContain(CLAUDE);
    expect(commits[0]?.date).toBe('2026-10-01');
  });

  it('counts agent, human and exempt commits with the commit-msg verdict', () => {
    const r = measureCoverage(parseMessages(raw));
    expect(r).toMatchObject({ total: 5, agent: 3, covered: 2, human: 1, exempt: 1 });
    expect(r.share).toBeCloseTo(2 / 3);
    expect(r.uncovered.map((u: { hash: string }) => u.hash)).toEqual(['b2']);
    expect(r.uncovered[0]?.subject).toBe('fix: untraced');
  });

  it('reports no share, not 100%, when the window holds no agent commit', () => {
    const r = measureCoverage(parseMessages(record('h1', 'docs: by hand\n')));
    expect(r).toMatchObject({ total: 1, agent: 0, human: 1 });
    expect(r.share).toBeNull();
  });
});

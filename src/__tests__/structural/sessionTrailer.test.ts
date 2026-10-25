// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  SESSION_KEYS,
  classifyCommitMessage,
  parseTrailers,
} from '../../../scripts/git/check-session-trailer.mjs';

/**
 * `scripts/git/check-session-trailer.mjs` decides whether a commit message owes an
 * `Agent-Session:` trailer. These cases pin the decision: an agent commit (one
 * co-authored by Claude, or carrying the harness's Claude-Session) must name its
 * session; a human commit and a git-written merge/revert never have to.
 */
const CLAUDE = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

describe('session trailer check', () => {
  it('reads the session trailers from by-session.mjs, not Work-Package', () => {
    expect(SESSION_KEYS).toEqual(['Claude-Session', 'Agent-Session']);
  });

  it('passes an agent commit that names its session', () => {
    const msg = `feat: add the thing\n\nWhy it matters.\n\nAgent-Session: my-run@2026-10-10\n${CLAUDE}\n`;
    expect(classifyCommitMessage(msg)).toMatchObject({ kind: 'agent', ok: true });
  });

  it('passes a harness commit whose Claude-Session is its own session trailer', () => {
    const msg = 'chore: tidy\n\nClaude-Session: https://claude.ai/code/session_123\n';
    expect(classifyCommitMessage(msg)).toMatchObject({ kind: 'agent', ok: true });
  });

  it('rejects an agent commit with no session trailer', () => {
    const msg = `fix: partial work on the release notes\n\n${CLAUDE}\n`;
    expect(classifyCommitMessage(msg)).toMatchObject({ kind: 'agent', ok: false });
  });

  it('ignores git comment lines and the --verbose diff below the scissors', () => {
    const msg =
      `feat: z\n\n${CLAUDE}\n# Please enter the commit message for your changes.\n` +
      '# ------------------------ >8 ------------------------\n' +
      'diff --git a/x b/x\nAgent-Session: from-the-diff@2026-10-10\n';
    expect(classifyCommitMessage(msg)).toMatchObject({ kind: 'agent', ok: false });
  });

  it('passes a human commit, including a one-line subject that looks like a trailer', () => {
    expect(classifyCommitMessage('fix: typo in README\n\nSigned-off-by: Jane Doe <jane@example.com>\n')).toMatchObject({
      kind: 'human',
      ok: true,
    });
    expect(parseTrailers('fix: thing')).toEqual([]);
    expect(classifyCommitMessage('fix: thing')).toMatchObject({ kind: 'human', ok: true });
  });

  it('exempts merges, reverts and autosquash subjects even when co-authored', () => {
    for (const subject of ["Merge branch 'feature'", 'Revert "feat: x"', 'fixup! feat: x', 'squash! feat: x']) {
      expect(classifyCommitMessage(`${subject}\n\n${CLAUDE}\n`)).toMatchObject({ kind: 'exempt', ok: true });
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDecisionIndex, OUTPUT } from '../../../scripts/docs/gen-decision-index.mjs';

/**
 * `docs/decisions.md` is the one index over the repo's four decision stores
 * (.ai/memory, the directions ledger, and the two ship-loop decision logs). It is
 * generated, and a generated file nobody can check is a promise in a header.
 * This test is the check: it rebuilds the index from the stores and compares it
 * with the committed copy, so a decision recorded without regenerating fails
 * `npm test` with the command that fixes it, rather than leaving the index quietly
 * one decision short.
 */
const REPO = resolve(__dirname, '../../..');

describe('decision index', () => {
  const { markdown, total, problems } = buildDecisionIndex(REPO);

  it('parses every store, and every memory file has valid frontmatter', () => {
    // A store that yields nothing means the parser broke, not that nothing was decided.
    expect(problems).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  it('matches the committed docs/decisions.md', () => {
    const committed = readFileSync(resolve(REPO, OUTPUT), 'utf8').replace(/\r\n/g, '\n');
    expect(
      committed.trim() === markdown.trim(),
      `${OUTPUT} is stale: run \`node scripts/docs/gen-decision-index.mjs\` and commit the result`,
    ).toBe(true);
  });
});

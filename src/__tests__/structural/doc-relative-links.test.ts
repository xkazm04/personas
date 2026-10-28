// @vitest-environment node
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GUIDANCE_FILES,
  headingSlugs,
  linksIn,
  measure,
  problemWith,
} from '../../../scripts/docs/check-relative-links.mjs';

/**
 * The guidance a contributor or agent reads first (README, CONTRIBUTING,
 * AGENTS, CLAUDE, .claude/CLAUDE.md) must not point at files that are gone.
 * CONTRIBUTING.md did, at `ARCHITECTURE.md` and `docs/DEVELOPMENT.md`, while it
 * also described a workflow the rest of the guidance had replaced; this test
 * follows every relative link and heading anchor so the next drift fails here.
 */
const REPO = resolve(__dirname, '../../..');

describe('guidance relative links', () => {
  const measured = measure(REPO);

  it('every relative link and anchor in the guidance resolves', () => {
    const broken = measured.broken.map((b) => `${b.file}:${b.line} (${b.target}) ${b.problem}`);
    expect(broken, 'run `node scripts/docs/check-relative-links.mjs` for the list').toEqual([]);
  });

  it('actually looked: every guidance file was read and the links were found', () => {
    // "Found nothing" and "looked at nothing" are different outcomes; a link
    // matcher that silently stopped matching would otherwise pass the test above.
    expect(measured.filesSeen).toBe(GUIDANCE_FILES.length);
    expect(measured.linksSeen).toBeGreaterThanOrEqual(80);
  });

  it('skips external links and links quoted as code', () => {
    const md = [
      '[web](https://example.com/x.md) and [mail](mailto:a@b.c)',
      'quoted: `[not a link](./nowhere.md)`',
      '```',
      '[also not](./gone.md)',
      '```',
      '[real](./docs/README.md#top) ![img](./a.png "title")',
    ].join('\n');
    expect(linksIn(md)).toEqual([
      { line: 6, target: './docs/README.md#top' },
      { line: 6, target: './a.png' },
    ]);
  });

  it('slugs headings the way GitHub does', () => {
    const slugs = headingSlugs(
      [
        '## Internationalization (i18n)',
        "### 7. Companions: the app's own agents",
        '### The golden-path census — the gate most likely to fail',
        '## `features/agents/sub_*` map',
        '## Repeat',
        '## Repeat',
        '```',
        '# not a heading',
        '```',
      ].join('\n'),
    );
    expect([...slugs]).toEqual([
      'internationalization-i18n',
      '7-companions-the-apps-own-agents',
      'the-golden-path-census--the-gate-most-likely-to-fail',
      'featuresagentssub_-map',
      'repeat',
      'repeat-1',
    ]);
  });

  it('reports a missing file and a missing anchor, and accepts what exists', () => {
    expect(problemWith(REPO, 'CONTRIBUTING.md', './ARCHITECTURE.md')).toMatch(/does not exist/);
    expect(problemWith(REPO, 'CONTRIBUTING.md', './README.md#no-such-heading-here')).toMatch(/no heading/);
    expect(problemWith(REPO, 'CONTRIBUTING.md', './README.md#prerequisites')).toBeNull();
    expect(problemWith(REPO, '.claude/CLAUDE.md', '../AGENTS.md')).toBeNull();
    expect(problemWith(REPO, 'README.md', '../outside.md')).toMatch(/escapes/);
  });
});

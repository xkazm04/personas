import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractBlock,
  MANIFEST,
  parseCapabilities,
  parseGuidance,
  renderBlock,
  syncProjections,
} from '../../../.ai/project-commands.mjs';

/**
 * The commands an agent runs are declared once, in `.ai/manifest.yaml`, and
 * projected into AGENTS.md and the root CLAUDE.md as a generated block. This
 * test is the check that keeps the projections honest: a command edited in one
 * place and not the others fails `npm test` with the command that fixes it,
 * instead of leaving two guidance files quietly disagreeing.
 */
const REPO = resolve(__dirname, '../../..');

describe('guidance command table', () => {
  const manifestText = readFileSync(resolve(REPO, MANIFEST), 'utf8');

  it('reads the capabilities and the projections from the manifest', () => {
    const names = parseCapabilities(manifestText).map((c: { name: string }) => c.name);
    expect(names).toContain('typecheck');
    expect(names).toContain('test');
    const { doneGate, projections } = parseGuidance(manifestText);
    expect(doneGate).toBeTruthy();
    expect(projections).toEqual(['AGENTS.md', 'CLAUDE.md']);
  });

  it('every projection carries the current block', () => {
    const results = syncProjections({ root: REPO });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.filter((r: { status: string }) => r.status !== 'ok'),
      'a guidance block is out of step with .ai/manifest.yaml: run `node .ai/project-commands.mjs --write`',
    ).toEqual([]);
  });

  it('renders every declared command, and a changed command no longer matches', () => {
    const block = renderBlock(manifestText);
    for (const c of parseCapabilities(manifestText)) expect(block).toContain(`\`${c.command}\``);
    const edited = manifestText.replace('npx tsc --noEmit', 'npx tsc -p tsconfig.app.json --noEmit');
    expect(renderBlock(edited)).not.toEqual(block);
    expect(extractBlock(`intro\n${block}\noutro`)).toEqual(block);
    expect(extractBlock('no markers here')).toBeNull();
  });
});

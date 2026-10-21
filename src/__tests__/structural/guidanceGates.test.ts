import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractBlock, MANIFEST, parseGuidance, renderBlock } from '../../../.ai/project-commands.mjs';

/**
 * "When am I done?" and "what must be green before I push?" have one answer
 * each, declared in `.ai/manifest.yaml` (`guidance.doneGate`,
 * `guidance.prePushGate`) and rendered into the generated block of every
 * projection. The root CLAUDE.md once stated the done gate twice, as "gate,
 * then check" in its prose and as the gate alone in its block, so an agent got
 * a different answer depending on which line it read. This test keeps the
 * gates in the block only: a projection that restates either command outside
 * its block fails, and so does a manifest that drops either gate.
 */
const REPO = resolve(__dirname, '../../..');

const outsideBlock = (text: string): string => {
  const block = extractBlock(text);
  const lf = text.replace(/\r\n/g, '\n');
  return block === null ? lf : lf.replace(block, '');
};

describe('guidance gates are stated once', () => {
  const manifestText = readFileSync(resolve(REPO, MANIFEST), 'utf8');
  const { doneGate, prePushGate, projections } = parseGuidance(manifestText);

  it('the manifest declares a done gate and a distinct pre-push gate', () => {
    expect(doneGate).toBeTruthy();
    expect(prePushGate).toBeTruthy();
    expect(prePushGate).not.toEqual(doneGate);
  });

  it('the rendered block names each gate exactly once', () => {
    const block = renderBlock(manifestText);
    expect(block.split(`Before you report done: \`${doneGate}\``).length - 1).toBe(1);
    expect(block.split(`Before you push: \`${prePushGate}\``).length - 1).toBe(1);
    const withoutPrePush = manifestText.replace(/^\s+prePushGate:.*$/m, '');
    expect(renderBlock(withoutPrePush)).not.toContain('Before you push:');
  });

  it('no projection restates a gate outside its generated block', () => {
    expect(projections.length).toBeGreaterThan(0);
    const restated: string[] = [];
    for (const file of projections) {
      const prose = outsideBlock(readFileSync(resolve(REPO, file), 'utf8'));
      for (const gate of [doneGate, prePushGate]) {
        if (gate && prose.includes(`\`${gate}\``)) restated.push(`${file}: \`${gate}\``);
      }
    }
    expect(
      restated,
      'a gate command is restated in prose: point at the generated block instead, and change the gate in .ai/manifest.yaml',
    ).toEqual([]);
  });
});

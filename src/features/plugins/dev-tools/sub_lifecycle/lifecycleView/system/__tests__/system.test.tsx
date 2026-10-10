import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DEFAULT_RULES, healthyMix } from '../../../journey/__tests__/fixtures';
import { freshnessOf } from '../../frame/freshness';
import { fillTemplate } from '../../frame/fillTemplate';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { BindingPill, OutcomePill, RunPill, VerdictPill } from '../Pill';
import { budgetFor, kindsForStep, thresholdsFor } from '../rules';

const MODULE_ROOT = resolve(__dirname, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the one pill', () => {
  it('keeps failed, timed out and did-not-run apart without colour', () => {
    renderLayer1(
      <div>
        <RunPill outcome="failed" />
        <RunPill outcome="timeout" />
        <RunPill outcome="did_not_run" />
        <RunPill outcome="passed" />
      </div>,
      healthyMix(),
    );
    const pill = (o: string) => document.querySelector(`[data-outcome="${o}"]`)!;
    const look = (o: string) => `${pill(o).getAttribute('data-stroke')}|${pill(o).getAttribute('data-filled')}`;
    expect(look('failed')).toBe('solid|true');
    expect(look('timeout')).toBe('dotted|false');
    expect(look('did_not_run')).toBe('dashed|false');
    // Three outcomes, three different colourless looks.
    expect(new Set([look('failed'), look('timeout'), look('did_not_run')]).size).toBe(3);
    // Each carries its own glyph too.
    expect(new Set(['failed', 'timeout', 'did_not_run'].map((o) => pill(o).querySelector('svg')?.getAttribute('class')))).toHaveProperty('size', 3);
    expect(screen.getByText('Timed out')).toBeTruthy();
  });

  it('draws every vocabulary through the same component', () => {
    renderLayer1(
      <div>
        <VerdictPill health="stale" />
        <OutcomePill outcome="skipped" />
        <BindingPill state="missing" />
      </div>,
      healthyMix(),
    );
    expect(document.querySelector('[data-health="stale"]')?.getAttribute('data-stroke')).toBe('dotted');
    expect(document.querySelector('[data-outcome="skipped"]')?.getAttribute('data-stroke')).toBe('hairline');
    expect(document.querySelector('[data-state="missing"]')?.getAttribute('data-stroke')).toBe('dotted');
    for (const el of document.querySelectorAll('[data-stroke]')) expect(el.className).toContain('rounded-pill');
  });
});

describe('freshness', () => {
  const base = { branch: 'master', sha: 'a1b2c3d4e5f6', measuredSha: null, commitsBehind: null, measuredAt: null };

  it('says nothing without a base branch, and never measured before the first Measure', () => {
    expect(freshnessOf(null)).toBeNull();
    expect(freshnessOf(base)).toEqual({ kind: 'never' });
  });

  it('is up to date on the tip, behind by a count, and makes no claim when the distance is unknown', () => {
    const at = '2026-10-08T09:30:00Z';
    expect(freshnessOf({ ...base, measuredSha: base.sha, commitsBehind: 0, measuredAt: at }))
      .toEqual({ kind: 'current', at, sha: 'a1b2c3d', branch: 'master' });
    expect(freshnessOf({ ...base, measuredSha: 'ffff0000aaaa', commitsBehind: 14, measuredAt: at }))
      .toEqual({ kind: 'behind', at, count: 14, branch: 'master' });
    expect(freshnessOf({ ...base, measuredSha: 'ffff0000aaaa', commitsBehind: null, measuredAt: at }))
      .toEqual({ kind: 'measured', at, sha: 'ffff000' });
  });

  it('fills a template with nodes, keeping the template word order', () => {
    render(<p data-testid="t">{fillTemplate('Measured {time} on {sha}, {missing}', { time: <b>now</b>, sha: <i>abc</i> })}</p>);
    expect(screen.getByTestId('t').innerHTML).toBe('Measured <b>now</b> on <i>abc</i>, {missing}');
  });
});

describe('rules come from the snapshot', () => {
  it('reads budgets, kinds and thresholds from the shipped rules, with step params overriding', () => {
    expect(budgetFor(DEFAULT_RULES, 'lint', null)).toBe(60_000);
    expect(budgetFor(DEFAULT_RULES, 'lint', 5_000)).toBe(5_000);
    expect(kindsForStep(DEFAULT_RULES, 'tests')).toEqual(['test', 'coverage']);
    expect(kindsForStep(DEFAULT_RULES, 'docs')).toEqual([]);
    const params = healthyMix().steps[0]!.step.params;
    expect(thresholdsFor(DEFAULT_RULES, { ...params, coverageGreenPct: 85 })).toEqual({
      coverageGreenPct: 85, docsCleanPct: 90, doneRatePct: 80, amberFloorPct: 50,
    });
  });

  it('keeps no client copy of the rules: nothing in the module imports a healthRules file', () => {
    const files = sources(MODULE_ROOT);
    expect(files.length).toBeGreaterThan(40);
    const offenders = files.filter((f) => /from ['"][^'"]*healthRules['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

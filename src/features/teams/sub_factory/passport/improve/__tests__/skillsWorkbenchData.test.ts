import { describe, expect, it } from 'vitest';

import { resolveLane, skillCommand, usageHint, type SkillsWorkbench } from '../skillsWorkbenchData';

describe('skillsWorkbenchData — pure helpers', () => {
  it('skillCommand builds a slash command, args optional + trimmed', () => {
    expect(skillCommand('kpi-sim', '')).toBe('/kpi-sim');
    expect(skillCommand('kpi-sim', '   ')).toBe('/kpi-sim');
    expect(skillCommand('kpi-sim', '  run --l2 ')).toBe('/kpi-sim run --l2');
  });

  it('usageHint prefers a backticked slash-command span', () => {
    expect(usageHint('Measures KPIs. Invoke with `/kpi-sim run [--l2]`.')).toBe('/kpi-sim run [--l2]');
  });

  it('usageHint falls back to an "Invoke with" clause, else null', () => {
    expect(usageHint('Does a thing. Invoke with /uat run args here. More text.')).toBe('/uat run args here');
    expect(usageHint('A plain description with no invocation line.')).toBeNull();
    expect(usageHint(null)).toBeNull();
  });
});

describe('skillsWorkbenchData — resolveLane', () => {
  const wb = {
    projectName: 'demo',
    counts: { reused: 1, own: 2 },
    adopt: { items: [{ name: 'a', description: null, sourceLabel: 'Global library', usage: null }] },
    share: { items: [{ name: 's', description: null, sourceLabel: null, usage: null }] },
    dispatch: { items: [{ name: 'd', description: null, sourceLabel: 'project', usage: null }], loading: true },
    managing: true,
    dispatching: false,
    runAdopt: async () => {},
    runShare: async () => {},
    runDispatch: async () => {},
  } as unknown as SkillsWorkbench;

  it('dispatch lane → installed items + dispatching busy + runDispatch', () => {
    const lane = resolveLane(wb, 'dispatch', 'adopt');
    expect(lane.kind).toBe('dispatch');
    expect(lane.items.map((i) => i.name)).toEqual(['d']);
    expect(lane.loading).toBe(true);
    expect(lane.busy).toBe(false);
    expect(lane.run).toBe(wb.runDispatch);
  });

  it('manage/adopt → adopt items + managing busy + runAdopt', () => {
    const lane = resolveLane(wb, 'manage', 'adopt');
    expect(lane.kind).toBe('adopt');
    expect(lane.items.map((i) => i.name)).toEqual(['a']);
    expect(lane.busy).toBe(true);
    expect(lane.run).toBe(wb.runAdopt);
  });

  it('manage/share → share items + runShare', () => {
    const lane = resolveLane(wb, 'manage', 'share');
    expect(lane.kind).toBe('share');
    expect(lane.items.map((i) => i.name)).toEqual(['s']);
    expect(lane.run).toBe(wb.runShare);
  });
});

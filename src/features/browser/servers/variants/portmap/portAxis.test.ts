import { describe, expect, it } from 'vitest';

import type { DevServerView } from '@/lib/bindings/DevServerView';

import { UNIT, buildPortAxis } from './portAxis';

function server(projectId: string, devPort: number): DevServerView {
  return {
    projectId, projectName: projectId, rootPath: `C:\\dev\\${projectId}`, workspaceId: null, techStack: null,
    devCommand: 'npm run dev', devPort, state: 'stopped', pid: null, externalPid: null, startedAt: null,
    url: `http://localhost:${devPort}`, error: null,
  };
}

const FLEET = [1420, 3000, 3001, 3002, 3003, 4321, 8080, 3005, 5173, 8000].map((port, i) => server(`p${i}`, port));

describe('buildPortAxis', () => {
  it('cuts the fixture fleet into bands and keeps the free hole of a short run', () => {
    const axis = buildPortAxis(FLEET);
    expect(axis.bands.map((b) => [b.from, b.to])).toEqual([
      [1420, 1420], [3000, 3005], [4321, 4321], [5173, 5173], [8000, 8000], [8080, 8080],
    ]);
    expect(axis.breaks).toHaveLength(5);
    expect(axis.breaks[0]).toMatchObject({ from: 1421, to: 2999 });
    expect(axis.holes.map((h) => h.port)).toEqual([3004]);
    expect(axis.pins.map((p) => p.port)).toEqual([1420, 3000, 3001, 3002, 3003, 3005, 4321, 5173, 8000, 8080]);
  });

  it('places pins in port order, one unit apart inside a band, and alternates rows', () => {
    const { pins } = buildPortAxis(FLEET);
    for (let i = 1; i < pins.length; i++) expect(pins[i]!.center).toBeGreaterThan(pins[i - 1]!.center);
    const p3000 = pins.find((p) => p.port === 3000)!;
    const p3001 = pins.find((p) => p.port === 3001)!;
    expect(p3001.center - p3000.center).toBe(UNIT);
    expect(pins.map((p) => p.row)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it('keeps each pin on its own slot index for the callout row', () => {
    const { pins } = buildPortAxis(FLEET);
    expect(pins.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('stacks a port collision on one pin', () => {
    const axis = buildPortAxis([server('a', 3000), server('b', 3000), server('c', 3001)]);
    expect(axis.pins).toHaveLength(2);
    expect(axis.pins[0]!.servers.map((s) => s.projectId)).toEqual(['a', 'b']);
  });

  it('draws only occupied ports when a band is long or sparse', () => {
    const axis = buildPortAxis([server('a', 3000), server('b', 3009)]);
    expect(axis.bands).toHaveLength(1);
    expect(axis.holes).toHaveLength(0);
    expect(axis.pins[1]!.center - axis.pins[0]!.center).toBe(UNIT);
  });

  it('is empty for no servers', () => {
    const axis = buildPortAxis([]);
    expect(axis.pins).toHaveLength(0);
    expect(axis.bands).toHaveLength(0);
  });
});

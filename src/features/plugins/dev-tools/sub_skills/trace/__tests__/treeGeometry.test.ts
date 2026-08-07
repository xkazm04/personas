import { describe, expect, it } from 'vitest';

import type { SkillLessonRow } from '@/api/devTools/devTools';

import type { TreeBranch } from '../traceTypes';
import { angleSlots, layoutTree, pointOnCubic } from '../treeGeometry';

const lesson: SkillLessonRow = {
  skill: 's', scope: 'project', project_id: 'p', project_name: 'p',
  version: '1.0', date: '2026-08-07', lesson: 'x', is_redesign: false,
};

function branch(weight: number, lessons = 0): TreeBranch {
  return {
    project: { id: `p${weight}`, name: `p${weight}`, rootPath: '/' },
    weight,
    invokes30d: Math.round(weight * 10),
    lastInvokedAt: null,
    installedVersion: '1.0',
    drift: 'in_sync',
    lessons: Array.from({ length: lessons }, () => lesson),
  };
}

describe('angleSlots', () => {
  it('centers a single branch and keeps all slots inside the arc', () => {
    expect(angleSlots(0)).toEqual([]);
    expect(angleSlots(1)).toEqual([-90]);
    for (const n of [2, 3, 7]) {
      const slots = angleSlots(n);
      expect(slots).toHaveLength(n);
      for (const a of slots) {
        expect(a).toBeGreaterThan(-200);
        expect(a).toBeLessThan(20);
      }
      expect(new Set(slots).size).toBe(n); // distinct
    }
  });

  it('assigns the first (heaviest) branch the most-vertical slot', () => {
    const slots = angleSlots(5);
    const mid = -90;
    const distances = slots.map((a) => Math.abs(a - mid));
    expect(distances[0]).toBe(Math.min(...distances));
  });
});

describe('layoutTree', () => {
  it('is deterministic and monotone in weight for stroke width', () => {
    const branches = [branch(1), branch(0.5), branch(0.1)];
    const a = layoutTree(branches);
    const b = layoutTree(branches);
    expect(a).toEqual(b);
    expect(a[0].strokeWidth).toBeGreaterThan(a[1].strokeWidth);
    expect(a[1].strokeWidth).toBeGreaterThan(a[2].strokeWidth);
  });

  it('places lesson sprouts on the bezier (max 3)', () => {
    const geo = layoutTree([branch(1, 5)])[0];
    expect(geo.lessonPoints).toHaveLength(3);
    const [p0, c1, c2, p3] = geo.controls;
    // Each sprout coincides with the curve at its parameter.
    const expected = [0.55, 0.68, 0.81].map((t) => pointOnCubic(p0, c1, c2, p3, t));
    geo.lessonPoints.forEach((pt, i) => {
      expect(pt.x).toBeCloseTo(expected[i].x, 10);
      expect(pt.y).toBeCloseTo(expected[i].y, 10);
    });
  });

  it('pointOnCubic hits the endpoints at t=0 and t=1', () => {
    const p0 = { x: 0, y: 0 };
    const p3 = { x: 10, y: 10 };
    expect(pointOnCubic(p0, { x: 3, y: 0 }, { x: 7, y: 10 }, p3, 0)).toEqual(p0);
    expect(pointOnCubic(p0, { x: 3, y: 0 }, { x: 7, y: 10 }, p3, 1)).toEqual(p3);
  });
});

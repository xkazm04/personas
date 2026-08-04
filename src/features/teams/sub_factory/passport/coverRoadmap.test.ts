import { describe, expect, it } from 'vitest';

import { milestone } from '../l2/ship/__tests__/shipFixtures';
import { buildCoverRoadmap } from './CoverRoadmap';

const shipped = (id: string, order: number, cut: string, days: number) => milestone({
  id, name: id, orderIndex: order, status: 'shipped',
  cutAt: `${cut}T00:00:00Z`,
  shippedAt: new Date(Date.parse(`${cut}T00:00:00Z`) + days * 86_400_000).toISOString(),
});

describe('buildCoverRoadmap', () => {
  it('orders pips by order_index and names the next milestone', () => {
    const vm = buildCoverRoadmap([
      milestone({ id: 'c', name: 'v3', orderIndex: 2, status: 'planned' }),
      shipped('a', 0, '2026-01-01', 10),
      milestone({ id: 'b', name: 'v2', orderIndex: 1, status: 'active' }),
    ]);
    expect(vm.steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(vm.shipped).toBe(1);
    expect(vm.next?.name).toBe('v2');
  });

  it('carries a forecast for the next milestone once the history supports one', () => {
    const vm = buildCoverRoadmap([
      shipped('a', 0, '2026-01-01', 10),
      shipped('b', 1, '2026-01-20', 20),
      milestone({ id: 'c', name: 'v3', orderIndex: 2, status: 'active', cutAt: '2026-02-10T00:00:00Z' }),
    ]);
    // median of [10, 20] = 15 days from the cut
    expect(vm.forecast).toEqual({ date: '2026-02-25', late: false });
  });

  it('shows no forecast below the evidence bar', () => {
    const vm = buildCoverRoadmap([
      shipped('a', 0, '2026-01-01', 10),
      milestone({ id: 'b', name: 'v2', orderIndex: 1, status: 'active', cutAt: '2026-02-10T00:00:00Z' }),
    ]);
    expect(vm.forecast).toBeNull();
  });

  it('flags a forecast landing past the declared target', () => {
    const vm = buildCoverRoadmap([
      shipped('a', 0, '2026-01-01', 30),
      shipped('b', 1, '2026-01-20', 30),
      milestone({ id: 'c', name: 'v3', orderIndex: 2, status: 'active', cutAt: '2026-02-10T00:00:00Z', targetDate: '2026-03-01' }),
    ]);
    expect(vm.forecast).toEqual({ date: '2026-03-12', late: true });
  });

  it('has no forecast when every milestone is shipped', () => {
    const vm = buildCoverRoadmap([shipped('a', 0, '2026-01-01', 10), shipped('b', 1, '2026-01-20', 20)]);
    expect(vm.next).toBeNull();
    expect(vm.forecast).toBeNull();
  });
});

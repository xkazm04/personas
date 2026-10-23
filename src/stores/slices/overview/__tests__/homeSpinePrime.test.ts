/**
 * What one Home prime costs. `fleetMetrics` lost its last reader when
 * FleetHealthStrip retired, yet every primeHomeSpine still fired
 * get_metrics_summary(1) for it. A prime reads exactly the three sources
 * Home renders.
 */
import { describe, expect, it, vi } from 'vitest';

const getMetricsSummary = vi.fn(() => Promise.resolve({}));
const listAllExecutions = vi.fn(() => Promise.resolve([]));
const listEventsInRange = vi.fn(() => Promise.resolve({ events: [] }));
const getAuditIncidentsSummary = vi.fn(() => Promise.resolve({ open: 2 }));

vi.mock('@/api/overview/observability', () => ({ getMetricsSummary: () => getMetricsSummary() }));
vi.mock('@/api/agents/executions', () => ({ listAllExecutions: () => listAllExecutions() }));
vi.mock('@/api/overview/events', () => ({ listEventsInRange: () => listEventsInRange() }));
vi.mock('@/api/overview/incidents', () => ({ getAuditIncidentsSummary: () => getAuditIncidentsSummary() }));

import { create } from 'zustand';
import { createHomeSpineSlice } from '../homeSpineSlice';
import type { OverviewStore } from '../../../storeTypes';

describe('primeHomeSpine', () => {
  it('fires the three read sources Home renders and no metrics aggregate', async () => {
    const store = create<OverviewStore>()((...a) => ({ ...createHomeSpineSlice(...a) }) as OverviewStore);
    store.getState().primeHomeSpine(true);
    await vi.waitFor(() => expect(store.getState().homeOpenIncidents).toBe(2));
    expect(listAllExecutions).toHaveBeenCalledTimes(1);
    expect(listEventsInRange).toHaveBeenCalledTimes(1);
    expect(getAuditIncidentsSummary).toHaveBeenCalledTimes(1);
    expect(getMetricsSummary).not.toHaveBeenCalled();
  });
});

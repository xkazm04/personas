// The publisher writes ONE settings document for the whole app, while each plan
// pane hands it only its own project's roadmap. These pin that a second
// project's publish does not erase the first project's verdicts, which is what
// the read op (`describe_ship_milestone`) serves Athena from.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShipMilestoneVM } from '@/lib/milestone/shipModel';
import { milestone } from '@/lib/milestone/__tests__/shipFixtures';

import {
  __resetShipReadinessPublisherForTests,
  PUBLISH_DEBOUNCE_MS,
  publishShipReadiness,
  SHIP_READINESS_KEY,
} from '../shipReadinessPublish';

const setAppSetting = vi.hoisted(() => vi.fn());
vi.mock('@/api/system/settings', () => ({ setAppSetting }));

function vm(id: string, projectId: string): ShipMilestoneVM {
  return {
    row: milestone({ id, projectId }),
    id,
    name: id,
    goal: null,
    description: null,
    status: 'active',
    targetLabel: null,
    members: [],
    goalMembers: [],
    boundGoals: [],
    footprint: [],
    skillCoverage: [],
    criteria: [],
    progress: 0,
    duality: { rated: 0, unrated: 0, agree: 0, disagree: 0, conflicts: [] },
  };
}

/** The milestone ids of the newest document written to the settings key. */
function lastPublishedIds(): string[] {
  const call = setAppSetting.mock.calls.at(-1);
  expect(call?.[0]).toBe(SHIP_READINESS_KEY);
  const doc: { milestones: { id: string }[] } = JSON.parse(String(call?.[1]));
  return doc.milestones.map((m) => m.id);
}

describe('publishShipReadiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAppSetting.mockReset();
    setAppSetting.mockResolvedValue(undefined);
    __resetShipReadinessPublisherForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the first project's milestones when a second project publishes", async () => {
    publishShipReadiness([vm('a-1', 'p-a'), vm('a-2', 'p-a')]);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    publishShipReadiness([vm('b-1', 'p-b')]);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);

    expect(lastPublishedIds().sort()).toEqual(['a-1', 'a-2', 'b-1']);
  });

  it("replaces a project's own milestones on its republish, so a deleted one drops out", async () => {
    publishShipReadiness([vm('a-1', 'p-a'), vm('a-2', 'p-a')]);
    publishShipReadiness([vm('b-1', 'p-b')]);
    publishShipReadiness([vm('a-1', 'p-a')]);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);

    expect(lastPublishedIds().sort()).toEqual(['a-1', 'b-1']);
    expect(setAppSetting).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for an unchanged document', async () => {
    publishShipReadiness([vm('a-1', 'p-a')]);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);
    publishShipReadiness([vm('a-1', 'p-a')]);
    await vi.advanceTimersByTimeAsync(PUBLISH_DEBOUNCE_MS);

    expect(setAppSetting).toHaveBeenCalledTimes(1);
  });
});

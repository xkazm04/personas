import { describe, it, expect } from 'vitest';
import { GROUP_ORDER } from '../FleetGridPage';
import { FLEET_STATE_META } from '../../fleetStateMeta';

// session-registry: every value of the closed lifecycle vocabulary must be
// renderable by the consumer that derives from it. A state the grid cannot
// group is a state whose sessions are invisible on the only tab that lists
// them, while the summary pill beside it still counts them.
describe('FleetGridPage GROUP_ORDER', () => {
  it('covers every state the shared fleet authority defines', () => {
    const rendered = new Set(GROUP_ORDER.map((g) => g.id));
    const authority = FLEET_STATE_META.map((m) => m.id);
    const missing = authority.filter((id) => !rendered.has(id));
    expect(missing).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sys = vi.hoisted(() => ({
  fleetSetActiveSession: vi.fn(),
  fleetSetGridOpen: vi.fn(),
  setSidebarSection: vi.fn(),
}));
const agent = vi.hoisted(() => ({ selectPersona: vi.fn() }));
const goals = vi.hoisted(() => ({ openGoalsBoard: vi.fn() }));

vi.mock('@/stores/systemStore', () => ({ useSystemStore: { getState: () => sys } }));
vi.mock('@/stores/agentStore', () => ({ useAgentStore: { getState: () => agent } }));
vi.mock('../../../guidance/appActions', () => goals);

import { useCompanionStore } from '../../../companionStore';
import { openRef, resolvableRef } from '../openRef';

describe('openRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanionStore.setState({
      reportViewId: null,
      activityTrayCollapsed: true,
      brainView: { open: false, kind: null, id: null },
      approvals: [],
      chatCards: [],
    });
  });

  it('report opens the Current reader, or the prototype layer when overridden', () => {
    expect(openRef('report', 'r1')).toBe(true);
    expect(useCompanionStore.getState().reportViewId).toBe('r1');
    const openReport = vi.fn();
    openRef('report', 'r2', { openReport });
    expect(openReport).toHaveBeenCalledWith('r2');
    expect(useCompanionStore.getState().reportViewId).toBe('r1');
  });

  it('session opens the fleet terminal on that session', () => {
    openRef('session', 's9');
    expect(sys.fleetSetActiveSession).toHaveBeenCalledWith('s9');
    expect(sys.fleetSetGridOpen).toHaveBeenCalledWith(true);
  });

  it('job unfolds the activity tray', () => {
    openRef('job', 'job_1');
    expect(useCompanionStore.getState().activityTrayCollapsed).toBe(false);
  });

  it('memory opens the brain viewer on the mapped kind; an unknown prefix is refused', () => {
    expect(openRef('memory', 'fact_abc1')).toBe(true);
    expect(useCompanionStore.getState().brainView).toEqual({ open: true, kind: 'fact', id: 'fact_abc1' });
    expect(openRef('memory', 'zzz_1')).toBe(false);
    expect(resolvableRef('memory', 'zzz_1')).toBe(false);
  });

  it('goal and persona use the existing route doors', () => {
    openRef('goal', 'g1');
    expect(goals.openGoalsBoard).toHaveBeenCalled();
    openRef('persona', 'p1');
    expect(agent.selectPersona).toHaveBeenCalledWith('p1');
    expect(sys.setSidebarSection).toHaveBeenCalledWith('personas');
  });

  it('approval / card / decision go to layer two in the prototypes', () => {
    const openWork = vi.fn();
    openRef('approval', 'a1', { openWork });
    openRef('card', 'c1', { openWork });
    openRef('decision', 'd1', { openWork });
    expect(openWork.mock.calls.map((c) => c[0])).toEqual(['approval:a1', 'card:c1', 'decision:d1']);
  });

  it('approval scrolls to whichever proposal stack has content in Current', () => {
    const el = document.createElement('div');
    el.setAttribute('data-companion-section', 'chat-cards');
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    useCompanionStore.setState({ chatCards: [{ kind: 'fleet_plan', id: 'c1' }] });
    expect(openRef('approval', 'a1')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
    useCompanionStore.setState({ chatCards: [] });
    expect(openRef('card', 'c1')).toBe(false);
    el.remove();
  });
});

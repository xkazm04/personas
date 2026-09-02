import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActiveProcess, ProcessNavigateTo } from '@/stores/slices/processActivitySlice';

const system = {
  setSidebarSection: vi.fn(),
  setEditorTab: vi.fn(),
  setPluginTab: vi.fn(),
  setDevToolsTab: vi.fn(),
  setTeamsTab: vi.fn(),
  setTemplateTab: vi.fn(),
};
const agent = { selectPersona: vi.fn(), restoreChatSession: vi.fn(() => Promise.resolve()) };
const silent = vi.fn();

vi.mock('@/stores/systemStore', () => ({ useSystemStore: { getState: () => system } }));
vi.mock('@/stores/agentStore', () => ({ useAgentStore: { getState: () => agent } }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => silent }));

const { navigateToProcess } = await import('./navigateToProcess');

function proc(navigateTo?: ProcessNavigateTo): ActiveProcess {
  return {
    domain: 'execution', startedAt: 0, status: 'running',
    toolCallCount: 0, costUsd: 0, ...(navigateTo ? { navigateTo } : {}),
  };
}

describe('navigateToProcess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op when the process declares no destination', () => {
    const dismiss = vi.fn();
    navigateToProcess(proc(), dismiss);
    expect(system.setSidebarSection).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('routes a section + tab through that section own tab setter', () => {
    const dismiss = vi.fn();
    navigateToProcess(proc({ section: 'teams', tab: 'competition' }), dismiss);
    expect(system.setSidebarSection).toHaveBeenCalledWith('teams');
    expect(system.setTeamsTab).toHaveBeenCalledWith('competition');
    expect(system.setTemplateTab).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
  });

  it('never pushes an unrelated section tab into setTemplateTab', () => {
    // The old `else` branch sent every non-personas/plugins/teams section here,
    // so `{section:'overview', tab:'executions'}` silently set the templates tab.
    navigateToProcess(proc({ section: 'overview', tab: 'executions' }), vi.fn());
    expect(system.setSidebarSection).toHaveBeenCalledWith('overview');
    expect(system.setTemplateTab).not.toHaveBeenCalled();
    expect(silent).toHaveBeenCalled();
  });

  it('refuses an unrecognised section entirely and reports it', () => {
    const dismiss = vi.fn();
    // Rehydrated persisted state from another build — the type says it cannot
    // happen, the runtime door says it must not navigate anywhere if it does.
    navigateToProcess(proc({ section: 'atlantis' as never }), dismiss);
    expect(system.setSidebarSection).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    expect(silent).toHaveBeenCalled();
  });

  it('restores a chat session only for the chat tab', () => {
    navigateToProcess(proc({ section: 'personas', tab: 'chat', personaId: 'p1', chatSessionId: 's1' }), vi.fn());
    expect(agent.selectPersona).toHaveBeenCalledWith('p1');
    expect(agent.restoreChatSession).toHaveBeenCalledWith('p1', 's1');
  });
});

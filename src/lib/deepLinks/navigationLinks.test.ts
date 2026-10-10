import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  agent: { personas: [] as { id: string }[], fetchPersonas: vi.fn(), selectPersona: vi.fn() },
  overview: { setPendingExecutionFocus: vi.fn(), setOverviewTab: vi.fn() },
  system: { setSidebarSection: vi.fn() },
  toast: { addToast: vi.fn() },
}));

vi.mock('@/stores/agentStore', () => ({ useAgentStore: { getState: () => h.agent } }));
vi.mock('@/stores/overviewStore', () => ({ useOverviewStore: { getState: () => h.overview } }));
vi.mock('@/stores/systemStore', () => ({ useSystemStore: { getState: () => h.system } }));
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => h.toast } }));
vi.mock('@/i18n/useTranslation', () => ({
  getActiveTranslations: () => ({ error_registry: { not_found_message: 'NOT FOUND' } }),
}));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));

import { isValidDeepLinkId, openExecutionFromLink, openPersonaFromLink } from './navigationLinks';

beforeEach(() => {
  vi.clearAllMocks();
  h.agent.personas = [];
  h.agent.fetchPersonas.mockResolvedValue(undefined);
});

describe('isValidDeepLinkId', () => {
  it('accepts the id pattern only', () => {
    expect(isValidDeepLinkId('abc-1_X')).toBe(true);
    expect(isValidDeepLinkId('a'.repeat(64))).toBe(true);
    for (const bad of ['', 'a'.repeat(65), 'a b', 'a/b', 'a.b', '../x', 'é', 42, null, undefined]) {
      expect(isValidDeepLinkId(bad)).toBe(false);
    }
  });
});

describe('openPersonaFromLink', () => {
  it('navigates without refetching when the persona is loaded', async () => {
    h.agent.personas = [{ id: 'p1' }];
    expect(await openPersonaFromLink('p1')).toBe(true);
    expect(h.agent.fetchPersonas).not.toHaveBeenCalled();
    expect(h.system.setSidebarSection).toHaveBeenCalledWith('personas');
    expect(h.agent.selectPersona).toHaveBeenCalledWith('p1');
  });

  it('refetches once and navigates when the persona appears', async () => {
    h.agent.fetchPersonas.mockImplementation(async () => {
      h.agent.personas = [{ id: 'p2' }];
    });
    expect(await openPersonaFromLink('p2')).toBe(true);
    expect(h.agent.fetchPersonas).toHaveBeenCalledTimes(1);
    expect(h.agent.selectPersona).toHaveBeenCalledWith('p2');
  });

  it('toasts an error and does not navigate when still missing', async () => {
    expect(await openPersonaFromLink('ghost')).toBe(false);
    expect(h.agent.fetchPersonas).toHaveBeenCalledTimes(1);
    expect(h.toast.addToast).toHaveBeenCalledWith('NOT FOUND', 'error');
    expect(h.agent.selectPersona).not.toHaveBeenCalled();
    expect(h.system.setSidebarSection).not.toHaveBeenCalled();
  });

  it('ignores an invalid id without touching anything', async () => {
    expect(await openPersonaFromLink('a/b')).toBe(false);
    expect(h.agent.fetchPersonas).not.toHaveBeenCalled();
    expect(h.toast.addToast).not.toHaveBeenCalled();
  });
});

describe('openExecutionFromLink', () => {
  it('sets the latch, tab and section', () => {
    expect(openExecutionFromLink('e1')).toBe(true);
    expect(h.overview.setPendingExecutionFocus).toHaveBeenCalledWith('e1');
    expect(h.overview.setOverviewTab).toHaveBeenCalledWith('executions');
    expect(h.system.setSidebarSection).toHaveBeenCalledWith('overview');
  });

  it('ignores an invalid id', () => {
    expect(openExecutionFromLink('x y')).toBe(false);
    expect(h.overview.setPendingExecutionFocus).not.toHaveBeenCalled();
  });
});

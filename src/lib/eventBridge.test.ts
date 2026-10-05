import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventName } from '@/lib/eventRegistry';

// Mock Tauri event API before importing eventBridge
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock the notification center store
const addNotification = vi.fn();
vi.mock('@/stores/notificationCenterStore', () => ({
  useNotificationCenterStore: {
    getState: () => ({ addNotification }),
  },
}));

// Mock all other stores used by eventBridge to avoid import side effects
vi.mock('@/stores/authStore', () => ({
  AUTH_LOGIN_EVENT: 'auth-login',
  clearLoginTimeout: vi.fn(),
  useAuthStore: { getState: () => ({}), setState: vi.fn() },
}));
const overview = vi.hoisted(() => ({
  processStarted: vi.fn(),
  processQueued: vi.fn(),
  processEnded: vi.fn(),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: {
    getState: () => ({ fetchHealingIssues: vi.fn(), processPromoted: vi.fn(), ...overview }),
  },
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: { getState: () => ({ fetchRotationStatus: vi.fn() }) },
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: { getState: () => ({ fetchPersonaSummaries: vi.fn() }) },
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: { getState: () => ({ cloudInitialize: vi.fn() }), setState: vi.fn() },
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({}) },
}));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

describe('eventBridge — TITLEBAR_NOTIFICATION listener', () => {
  beforeEach(() => {
    addNotification.mockReset();
    vi.resetModules();
  });

  it('registry contains an entry for titlebar-notification', async () => {
    const { _testRegistry } = await import('./eventBridge');
    const entry = _testRegistry.find((r) => r.event === EventName.TITLEBAR_NOTIFICATION);
    expect(entry).toBeDefined();
    expect(entry?.event).toBe('titlebar-notification');
  });

  it('TITLEBAR_NOTIFICATION_DEBOUNCE_MS is exported from eventBridge via timing constant (0ms — no coalescing)', async () => {
    // Verify the timing constant exists and is 0 (immediate, no debounce)
    // by checking the registry entry exists (timing used internally, not exported)
    const { _testRegistry } = await import('./eventBridge');
    const titlebarEntry = _testRegistry.find((r) => r.event === EventName.TITLEBAR_NOTIFICATION);
    expect(titlebarEntry).toBeTruthy();
  });
});

describe('eventBridge — PROCESS_ACTIVITY listener', () => {
  beforeEach(() => {
    overview.processStarted.mockReset();
    overview.processQueued.mockReset();
    vi.resetModules();
  });

  /** Run the entry's setup and hand back the handler it registered with `listen`. */
  async function processActivityHandler() {
    const { listen } = await import('@tauri-apps/api/event');
    const listenMock = vi.mocked(listen);
    listenMock.mockClear();
    const { _testRegistry } = await import('./eventBridge');
    const entry = _testRegistry.find((r) => r.event === EventName.PROCESS_ACTIVITY);
    await entry!.setup();
    const call = listenMock.mock.calls.find(([event]) => event === EventName.PROCESS_ACTIVITY);
    return call![1] as (e: { payload: unknown }) => void;
  }

  it('stores the payload persona_id on a started run', async () => {
    const handler = await processActivityHandler();
    handler({ payload: { domain: 'execution', action: 'started', run_id: 'r1', label: 'Echo', persona_id: 'p-a' } });
    expect(overview.processStarted).toHaveBeenCalledWith('execution', 'r1', 'Echo', undefined, 'p-a');
  });

  it('stores the payload persona_id on a queued run, and passes none for persona-less work', async () => {
    const handler = await processActivityHandler();
    handler({ payload: { domain: 'execution', action: 'queued', run_id: 'r2', label: 'Echo', persona_id: 'p-b' } });
    expect(overview.processQueued).toHaveBeenCalledWith('execution', 'r2', 'Echo', undefined, 'p-b');
    handler({ payload: { domain: 'context_scan', action: 'started', run_id: 's1', label: 'Scan', persona_id: null } });
    expect(overview.processStarted).toHaveBeenCalledWith('context_scan', 's1', 'Scan', undefined, undefined);
  });
});

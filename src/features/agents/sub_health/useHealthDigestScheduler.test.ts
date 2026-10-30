/**
 * The weekly digest scheduler's decision table: disabled / not due / due /
 * corrupt stamp / future stamp / digest failed / personas not loaded. Each
 * branch was documented in the hook and pinned by nothing until this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import en from '@/i18n/locales/en.json';

const DAY = 24 * 60 * 60 * 1000;

const {
  mockRunDigest, mockSendNotification, mockGetSetting, mockSetSetting, storeState,
} = vi.hoisted(() => ({
  mockRunDigest: vi.fn(),
  mockSendNotification: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  storeState: { personas: [] as Array<{ id: string }> },
}));

vi.mock('@/api/system/system', () => ({
  sendAppNotification: (title: string, body: string) => mockSendNotification(title, body),
}));
vi.mock('@/api/system/settings', () => ({
  getAppSetting: (key: string) => mockGetSetting(key),
  setAppSetting: (key: string, value: string) => mockSetSetting(key, value),
}));
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
  silentCatchNull: () => () => null,
}));
vi.mock('@/stores/agentStore', () => {
  const getState = () => ({ ...storeState, runFullHealthDigest: () => mockRunDigest() });
  const useAgentStore = vi.fn((selector: (s: ReturnType<typeof getState>) => unknown) => selector(getState()));
  (useAgentStore as unknown as { getState: typeof getState }).getState = getState;
  return { useAgentStore };
});
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return {
    ...actual,
    getActiveTranslations: () => ({ agents: { health_digest: en.agents.health_digest } }),
  };
});

import { useHealthDigestScheduler, parseLastRunMs } from './useHealthDigestScheduler';

const healthyDigest = {
  generatedAt: new Date().toISOString(),
  personas: [{}, {}],
  totalScore: { value: 100, grade: 'healthy' as const },
  totalIssues: 0, errorCount: 0, warningCount: 0, infoCount: 0, undeterminedCount: 0,
};

function settings(map: Record<string, string | null>) {
  mockGetSetting.mockImplementation(async (key: string) => map[key] ?? null);
}

async function flush() {
  // The effect's IIFE awaits four doors in sequence; a few microtask turns cover it.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  mockRunDigest.mockReset().mockResolvedValue(healthyDigest);
  mockSendNotification.mockReset().mockResolvedValue(undefined);
  mockGetSetting.mockReset();
  mockSetSetting.mockReset().mockResolvedValue(undefined);
  storeState.personas = [{ id: 'p1' }];
});

describe('parseLastRunMs', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');

  it('returns the instant for a sane ISO stamp', () => {
    expect(parseLastRunMs('2026-09-01T12:00:00Z', now)).toBe(Date.parse('2026-09-01T12:00:00Z'));
  });

  it('treats missing, empty and unparseable values as never-run', () => {
    expect(parseLastRunMs(null, now)).toBeNull();
    expect(parseLastRunMs(undefined, now)).toBeNull();
    expect(parseLastRunMs('', now)).toBeNull();
    expect(parseLastRunMs('garbage', now)).toBeNull();
  });

  it('tolerates a stamp slightly ahead of now but rejects one far in the future', () => {
    expect(parseLastRunMs(new Date(now + 2 * 60 * 60 * 1000).toISOString(), now)).not.toBeNull();
    expect(parseLastRunMs(new Date(now + 30 * DAY).toISOString(), now)).toBeNull();
  });
});

describe('useHealthDigestScheduler', () => {
  it('does nothing while no personas are loaded', async () => {
    storeState.personas = [];
    settings({});
    renderHook(() => useHealthDigestScheduler());
    await flush();
    expect(mockGetSetting).not.toHaveBeenCalled();
    expect(mockRunDigest).not.toHaveBeenCalled();
  });

  it('does nothing when the user disabled digests', async () => {
    settings({ health_digest_enabled: 'false' });
    renderHook(() => useHealthDigestScheduler());
    await flush();
    expect(mockRunDigest).not.toHaveBeenCalled();
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it('does nothing when the last digest is younger than a week', async () => {
    settings({ health_digest_last_run: new Date(Date.now() - 2 * DAY).toISOString() });
    renderHook(() => useHealthDigestScheduler());
    await flush();
    expect(mockRunDigest).not.toHaveBeenCalled();
  });

  it('runs, stamps and notifies when the last digest is older than a week', async () => {
    settings({ health_digest_last_run: new Date(Date.now() - 8 * DAY).toISOString() });
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1));
    expect(mockRunDigest).toHaveBeenCalledTimes(1);
    expect(mockSetSetting).toHaveBeenCalledWith('health_digest_last_run', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    const [title, body] = mockSendNotification.mock.calls[0]!;
    expect(title).toContain('Weekly Agent Health Digest');
    expect(body).toContain('100/100');
  });

  it('treats a corrupt stamp as never-run and runs once', async () => {
    settings({ health_digest_last_run: 'garbage' });
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockRunDigest).toHaveBeenCalledTimes(1));
  });

  it('treats a stamp far in the future as corrupt instead of silencing the digest', async () => {
    settings({ health_digest_last_run: new Date(Date.now() + 30 * DAY).toISOString() });
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockRunDigest).toHaveBeenCalledTimes(1));
    expect(mockSetSetting).toHaveBeenCalledWith('health_digest_last_run', expect.any(String));
  });

  it('neither stamps nor notifies when the digest attempt fails', async () => {
    settings({});
    mockRunDigest.mockResolvedValue(null);
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockRunDigest).toHaveBeenCalledTimes(1));
    await flush();
    expect(mockSetSetting).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

describe('useHealthDigestScheduler - app left open across the due date', () => {
  it('re-evaluates due-ness on an interval and fires once the stamp turns a week old', async () => {
    vi.useFakeTimers();
    try {
      settings({ health_digest_last_run: new Date(Date.now() - 6 * DAY).toISOString() });
      renderHook(() => useHealthDigestScheduler());
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(mockRunDigest).not.toHaveBeenCalled(); // 6 days old: not due yet
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * DAY); });
      expect(mockRunDigest).toHaveBeenCalledTimes(1);
      // The mocked stamp stays 6 days old, so only the latch keeps it from firing again.
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * DAY); });
      expect(mockRunDigest).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function check(name: string, severities: Array<'error' | 'warning' | 'info'>) {
  return {
    personaId: name.toLowerCase(), personaName: name, personaIcon: null, personaColor: null,
    checkedAt: new Date().toISOString(),
    result: { status: 'partial', issues: severities.map((severity, i) => ({ id: `${name}-${i}`, severity, description: `${name} ${severity}` })) },
  };
}

describe('useHealthDigestScheduler - the notification body', () => {
  it('counts only errors and warnings as issues, so an info-only fleet reads healthy', async () => {
    // A fresh install: every agent carries the `signal_unknown` info note.
    // The issue count used to include infos while the breakdown named only
    // errors and warnings: "3 issues across 3 agents (0 errors, 0 warnings)".
    mockRunDigest.mockResolvedValue({
      ...healthyDigest,
      personas: [check('A', ['info']), check('B', ['info']), check('C', ['info'])],
      totalScore: { value: 98, grade: 'healthy' as const },
      totalIssues: 3, infoCount: 3,
    });
    settings({});
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1));
    const [, body] = mockSendNotification.mock.calls[0]!;
    expect(body).toBe('All 3 agents are healthy! Score: 98/100');
  });

  it('names the agents that need attention, worst first, and leaves info-only agents out', async () => {
    mockRunDigest.mockResolvedValue({
      ...healthyDigest,
      personas: [check('Gamma', ['info']), check('Beta', ['warning']), check('Alpha', ['error', 'warning'])],
      totalScore: { value: 78, grade: 'degraded' as const },
      totalIssues: 3, errorCount: 1, warningCount: 2, infoCount: 1,
    });
    settings({});
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1));
    const [, body] = mockSendNotification.mock.calls[0]!;
    expect(body).toContain('3 issues across 3 agents (1 errors, 2 warnings)');
    expect(body).toContain('Needs attention: Alpha, Beta');
    expect(body).not.toContain('Gamma');
  });

  it('caps the named agents and says how many more there are', async () => {
    mockRunDigest.mockResolvedValue({
      ...healthyDigest,
      personas: ['A', 'B', 'C', 'D', 'E'].map((n) => check(n, ['warning'])),
      totalScore: { value: 90, grade: 'healthy' as const },
      totalIssues: 5, warningCount: 5,
    });
    settings({});
    renderHook(() => useHealthDigestScheduler());
    await waitFor(() => expect(mockSendNotification).toHaveBeenCalledTimes(1));
    const [, body] = mockSendNotification.mock.calls[0]!;
    expect(body).toContain('Needs attention: A, B, C +2 more');
  });
});

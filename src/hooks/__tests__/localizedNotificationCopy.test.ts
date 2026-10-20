/**
 * OS notifications and sidebar labels were English literals, so 13 of 14 locales
 * got English outside the translated app. These tests swap the catalog for a
 * marker catalog (every leaf reads back as its own dotted path): a literal
 * passes through unchanged and fails the assertion, a catalog key reads back
 * as its path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';


vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const toMarkers = (node: unknown, path: string): unknown =>
    node && typeof node === 'object'
      ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, toMarkers(v, path ? `${path}.${k}` : k)]))
      : path;
  const t = toMarkers(en, '');
  return {
    useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
    interpolate: (s: unknown) => String(s),
  };
});

const notify = vi.fn(async (_title: string, _body: string) => {});
vi.mock('@/api/system/system', () => ({ sendAppNotification: (a: unknown, b: unknown) => notify(a as string, b as string) }));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: { setRebuildActive: () => void }) => unknown) => sel({ setRebuildActive: vi.fn() }),
}));
vi.mock('@/api/overview/reviews', () => ({
  rebuildDesignReview: vi.fn(async () => ({ rebuild_id: 'r1' })),
  getRebuildSnapshot: vi.fn(() => new Promise(() => {})),
  cancelRebuild: vi.fn(async () => {}),
}));

let labBindings: Array<{ onTerminal: (p: { phase: string }) => void }> = [];
vi.mock('@/hooks/realtime/useRunEventListener', async (orig) => ({
  ...(await orig<typeof import('@/hooks/realtime/useRunEventListener')>()),
  useRunEventListener: (b: typeof labBindings) => { labBindings = b; },
}));

import { useBackgroundRebuild } from '@/hooks/design/core/useBackgroundRebuild';
import { useLabEvents } from '@/hooks/lab/useLabEvents';
import { useSidebarAgentActivity } from '@/hooks/sidebar/useSidebarAgentActivity';
import { useAgentStore } from '@/stores/agentStore';


describe('localized notification and label copy', () => {
  beforeEach(() => { notify.mockClear(); labBindings = []; });

  it('rebuild cancel error reads from the catalog', async () => {
    const { result } = renderHook(() => useBackgroundRebuild());
    await act(async () => result.current.cancelCurrentRebuild());
    expect(result.current.error).toBe('templates.bg_notify.rebuild_cancelled');
  });

  it('lab completion notification reads from the catalog', () => {
    renderHook(() => useLabEvents());
    labBindings[0]!.onTerminal({ phase: 'completed' });
    expect(notify).toHaveBeenCalledWith('agents.lab.notify_complete_title', 'agents.lab.notify_complete_body');
  });

  it('sidebar orbit labels read from the catalog', () => {
    useAgentStore.setState({
      personas: [],
      buildSessions: {},
      isExecuting: false,
      executionPersonaId: null,
      backgroundExecutions: [{ executionId: 'e1', personaId: 'p1', personaName: 'P', status: 'queued' }] as never,
      labRunningPersonaIds: ['p2'],
    } as never);
    const { result } = renderHook(() => useSidebarAgentActivity());
    expect(result.current.map((a) => a.label).sort()).toEqual([
      'shared.sidebar_extra.activity_execution_queued',
      'shared.sidebar_extra.activity_lab_run_in_progress',
    ]);
  });
});

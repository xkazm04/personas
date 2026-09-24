/**
 * [guard] case 8 (scan-sweep challenge-2026-09-23, agents-deployment-B): a
 * terminal EXECUTION_STATUS for a background run still reaches the
 * Notification Center. The mini player lane is additive; the bell keeps
 * working without it.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventName } from '@/lib/eventRegistry';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (e: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(event, cb);
    return () => {};
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}));

const addProcessNotification = vi.fn();
vi.mock('@/stores/notificationCenterStore', () => ({
  useNotificationCenterStore: { getState: () => ({ addProcessNotification }) },
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: { getState: () => ({ activeProcesses: {}, recentProcesses: [] }) },
}));

import { _testRegistry } from '@/lib/eventBridge';

describe('execution status -> notification center', () => {
  it('[guard] case 8: a failed background run still lands in the bell', async () => {
    const entry = _testRegistry.find((r) => r.event === EventName.EXECUTION_STATUS && r.priority === 'critical');
    expect(entry).toBeDefined();
    await entry!.setup();
    handlers.get(EventName.EXECUTION_STATUS)!({
      payload: { execution_id: 'bg1', status: 'failed', error: 'boom' },
    });
    expect(addProcessNotification).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'bg1', status: 'failed', summary: 'boom', redirectTab: 'executions' }),
    );
  });
});

/**
 * A failed alert write names its cause and tells the caller it failed.
 *
 * IPC rejects with a serialized AppError OBJECT. The slice used to toast
 * `${frame} ${err instanceof Error ? err.message : String(err)}`, i.e.
 * "Failed to create alert rule: [object Object]", and then RESOLVE, so
 * AlertRulesPanel closed the rule form (dropping the draft) on a refused save.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAlertRule = vi.fn();
const deleteAlertRule = vi.fn();
const listAlertRules = vi.fn();

vi.mock('@/api/overview/observability', () => ({
  createAlertRule: (...a: unknown[]) => createAlertRule(...a),
  deleteAlertRule: (...a: unknown[]) => deleteAlertRule(...a),
  listAlertRules: (...a: unknown[]) => listAlertRules(...a),
  updateAlertRule: vi.fn(),
  toggleAlertRule: vi.fn(),
  listFiredAlerts: vi.fn(),
  dismissFiredAlert: vi.fn(),
  clearFiredAlerts: vi.fn(),
  createFiredAlert: vi.fn(),
}));

import { create } from 'zustand';
import { createAlertSlice } from '../alertSlice';
import type { OverviewStore } from '../../../storeTypes';
import type { AlertRule } from '@/lib/bindings/AlertRule';
import { useToastStore } from '@/stores/toastStore';

function makeStore() {
  return create<OverviewStore>()((...a) => ({ ...createAlertSlice(...a) }) as OverviewStore);
}

const APP_ERROR = { error: 'Validation error: threshold must be positive', kind: 'Validation' };
const RULE: AlertRule = {
  id: 'r1', name: 'Errors', metric: 'error_rate', operator: '>', threshold: 5, severity: 'warning',
  persona_id: null, enabled: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

function lastToast(): string | undefined {
  const toasts = useToastStore.getState().toasts;
  return toasts[toasts.length - 1]?.message;
}

beforeEach(() => {
  createAlertRule.mockReset();
  deleteAlertRule.mockReset();
  listAlertRules.mockReset();
  useToastStore.setState({ toasts: [] });
});

describe('alertSlice writes', () => {
  it('a refused create rejects and toasts the AppError text', async () => {
    createAlertRule.mockRejectedValue(APP_ERROR);
    const store = makeStore();
    const { id: _id, created_at: _c, updated_at: _u, ...input } = RULE;
    await expect(store.getState().addAlertRule(input)).rejects.toBe(APP_ERROR);
    expect(lastToast()).toBe('Failed to create alert rule: Validation error: threshold must be positive');
  });

  it('a refused delete restores the rule, rejects and names the cause', async () => {
    deleteAlertRule.mockRejectedValue(APP_ERROR);
    const store = makeStore();
    store.setState({ alertRules: [RULE] });
    await expect(store.getState().deleteAlertRule('r1')).rejects.toBe(APP_ERROR);
    expect(store.getState().alertRules).toEqual([RULE]);
    expect(lastToast()).not.toContain('[object Object]');
  });

  it('a failed rules read keeps the AppError text in alertRulesError', async () => {
    listAlertRules.mockRejectedValue(APP_ERROR);
    const store = makeStore();
    await store.getState().fetchAlertRules(true);
    expect(store.getState().alertRulesError).toBe('Validation error: threshold must be positive');
  });
});

describe('alertSlice history read', () => {
  it('a failed history read is recorded, not swallowed', async () => {
    const { listFiredAlerts } = await import('@/api/overview/observability');
    vi.mocked(listFiredAlerts).mockRejectedValueOnce(APP_ERROR);
    const store = makeStore();
    await store.getState().fetchAlertHistory(true);
    expect(store.getState().alertHistoryError).toBe('Validation error: threshold must be positive');
    expect(store.getState().alertHistoryLoading).toBe(false);
  });
});

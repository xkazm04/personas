/**
 * BYOM save feedback was English literals ("Policy saved", "Cannot save: N blocking errors"), and
 * the compliance chips found their provider by searching the English message for a quoted label.
 * The catalog is mocked with each leaf replaced by its own key path, so a literal fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useByomSettings } from '../useByomSettings';

const addToast = vi.fn();
const policyRef = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const mark = (node: unknown, path: string): unknown =>
    typeof node === 'string'
      ? path
      : Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, mark(v, path ? `${path}.${k}` : k)]));
  const t = mark(en, '');
  const tx = (s: string, p?: Record<string, unknown>) => `${s}${p ? JSON.stringify(p) : ''}`;
  return { useTranslation: () => ({ t, tx }) };
});
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('@/api/system/byom', () => ({
  getByomPolicy: () => Promise.resolve(policyRef.current),
  setByomPolicy: vi.fn(() => Promise.resolve()),
  deleteByomPolicy: vi.fn(() => Promise.resolve()),
  listProviderAuditLog: () => Promise.resolve([]),
  getProviderUsageStats: () => Promise.resolve([]),
  getProviderUsageTimeseries: () => Promise.resolve([]),
}));

const B = 'settings.byom.';

beforeEach(() => {
  addToast.mockClear();
  policyRef.current = {
    enabled: true,
    allowed_providers: [],
    blocked_providers: ['claude-code'], // typo'd id: a blocking error
    routing_rules: [],
    compliance_rules: [],
  };
});

describe('useByomSettings copy', () => {
  it('refuses to save a blocking error with a catalog toast', async () => {
    const { result } = renderHook(() => useByomSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.handleSave(); });
    expect(addToast).toHaveBeenCalledWith(`${B}policy_toast_cannot_save_errors_one{"count":1}`, 'error');
  });

  it('describes the warning through the catalog and keeps the offending provider id', async () => {
    const { result } = renderHook(() => useByomSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.topLevelWarnings[0]).toMatchObject({
      code: 'blocked_unknown_provider',
      message: `${B}policy_warn_blocked_unknown_provider{"provider":"claude-code"}`,
    });
  });

  it('confirms a reset with a catalog toast', async () => {
    const { result } = renderHook(() => useByomSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.handleReset(); });
    expect(addToast).toHaveBeenCalledWith(`${B}policy_toast_reset`, 'success');
  });
});

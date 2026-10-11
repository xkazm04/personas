import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTriggerDetail } from '../useTriggerDetail';

const { fetchActivity, toastCatch } = vi.hoisted(() => ({
  fetchActivity: vi.fn(),
  toastCatch: vi.fn(() => vi.fn()),
}));

vi.mock('../useTriggerOperations', () => ({
  useTriggerOperations: () => ({ fetchActivity }),
}));
vi.mock('@/lib/silentCatch', () => ({ toastCatch }));
vi.mock('@/i18n/useTranslation', async () => {
  const { default: t } = await import('@/i18n/locales/en.json');
  return { useTranslation: () => ({ t, tx: (s: string, v: Record<string, unknown> = {}) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k])) }) };
});
vi.mock('@/hooks/utility/interaction/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));

describe('useTriggerDetail activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the error state when activity returns a failed result, then recovers on retry', async () => {
    fetchActivity.mockResolvedValueOnce({ ok: false, error: 'read failed' });
    fetchActivity.mockResolvedValueOnce({ ok: true, data: [] });
    const { result } = renderHook(() => useTriggerDetail('trigger-1', 'persona-1'));

    await act(async () => { await result.current.toggleActivityLog(); });
    expect(result.current.activityError).toBe(true);
    expect(result.current.activityLoading).toBe(false);

    await act(async () => { await result.current.retryActivityLog(); });
    expect(result.current.activityError).toBe(false);
    expect(fetchActivity).toHaveBeenCalledTimes(2);
  });
});

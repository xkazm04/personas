/**
 * A healing toast carries its persona id, and Resolve must hand it on. The
 * overview slice otherwise looks the issue up in `healingIssues`, which a toast
 * raised on any page is not guaranteed to hold; the resolve then refused while
 * the toast dismissed itself as if it had worked.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const { resolveHealingIssue } = vi.hoisted(() => ({
  resolveHealingIssue: vi.fn((_id: string, _personaId?: string) => Promise.resolve(true)),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: { getState: () => ({ resolveHealingIssue }) },
}));

vi.mock('@/i18n/useTranslation', async () => {
  const common = (await import('@/i18n/section-locales/en/common.json')).default;
  return {
    // INVARIANT for the cast: the JSON is what the generated proxy is built from.
    useTranslation: () => ({ t: { common } as never, tx: (s: string) => s }),
  };
});
vi.mock('@/i18n/useTranslatedError', () => ({
  resolveErrorTranslated: () => ({ message: '', category: 'unclassified' }),
  friendlySeverityTranslated: (_t: unknown, s: string) => s,
}));

import { ToastContainer } from '../ToastContainer';
import { useToastStore } from '@/stores/toastStore';

describe('healing toast Resolve', () => {
  it('resolves with the persona id the toast carries', async () => {
    act(() => {
      useToastStore.getState().addHealingToast({
        issueId: 'issue-7',
        personaId: 'persona-3',
        title: 'Rate limit loop',
        severity: 'high',
        personaName: 'Scout',
        suggestedFix: null,
      });
    });
    render(<ToastContainer />);
    await act(async () => { fireEvent.click(screen.getByText('Resolve')); });
    expect(resolveHealingIssue).toHaveBeenCalledWith('issue-7', 'persona-3');
    expect(useToastStore.getState().toasts.some((x) => x.id === 'healing-issue-7')).toBe(false);
  });

  it('keeps the toast when the resolve failed', async () => {
    resolveHealingIssue.mockResolvedValueOnce(false);
    act(() => {
      useToastStore.getState().addHealingToast({
        issueId: 'issue-8',
        personaId: 'persona-3',
        title: 'Budget loop',
        severity: 'high',
        personaName: 'Scout',
        suggestedFix: null,
      });
    });
    render(<ToastContainer />);
    await act(async () => { fireEvent.click(screen.getByText('Resolve')); });
    expect(resolveHealingIssue).toHaveBeenCalledWith('issue-8', 'persona-3');
    expect(useToastStore.getState().toasts.some((x) => x.id === 'healing-issue-8')).toBe(true);
  });
});

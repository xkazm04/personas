import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

const discover = vi.fn();
vi.mock('@/api/discovery/discovery', () => ({
  discoverConnectorResources: (...args: unknown[]) => discover(...args),
}));
const vault = vi.hoisted(() => ({
  credentials: [{ id: 'cred-gh', service_type: 'github', name: 'GH' }] as Array<Record<string, unknown>>,
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: typeof vault) => unknown) => sel(vault),
}));
// Stable identity, as the real provider gives: a fresh `t` per render would
// re-run the hook's effect on every render and mask what it does on one pass.
vi.mock('@/i18n/useTranslation', () => {
  const i18n = { t: { templates: { adopt_modal: {} } }, tx: (tpl: string) => tpl };
  return { useTranslation: () => i18n };
});

import { useDynamicQuestionOptions } from '../useDynamicQuestionOptions';

const QUESTIONS = [
  { id: 'repo', question: 'Repo?', type: 'select' },
  {
    id: 'branch',
    question: 'Branch?',
    type: 'select',
    dynamic_source: { service_type: 'github', operation: 'list_branches', depends_on: 'repo' },
  },
] as unknown as TransformQuestionResponse[];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useDynamicQuestionOptions - chained (depends_on) questions', () => {
  beforeEach(() => discover.mockReset());

  it('refetches when the parent is cleared and the same value is picked again', async () => {
    discover.mockResolvedValue([{ value: 'main', label: 'main' }]);
    const { result, rerender } = renderHook(
      ({ answers }) => useDynamicQuestionOptions(QUESTIONS, answers),
      { initialProps: { answers: { repo: 'acme/app' } as Record<string, string> } },
    );
    await waitFor(() => expect(result.current.dynamicOptions.branch?.items).toHaveLength(1));

    rerender({ answers: {} });
    await waitFor(() => expect(result.current.dynamicOptions.branch?.waitingOnParent).toBe(true));

    rerender({ answers: { repo: 'acme/app' } });
    await waitFor(() => expect(result.current.dynamicOptions.branch?.items).toHaveLength(1));
    expect(result.current.dynamicOptions.branch?.waitingOnParent).toBe(false);
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it('drops a response that lands after its parent answer was cleared', async () => {
    const pending = deferred<Array<{ value: string; label: string }>>();
    discover.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ answers }) => useDynamicQuestionOptions(QUESTIONS, answers),
      { initialProps: { answers: { repo: 'acme/app' } as Record<string, string> } },
    );
    await waitFor(() => expect(result.current.dynamicOptions.branch?.loading).toBe(true));

    rerender({ answers: {} });
    await waitFor(() => expect(result.current.dynamicOptions.branch?.waitingOnParent).toBe(true));

    await act(async () => {
      pending.resolve([{ value: 'main', label: 'main' }]);
      await pending.promise;
    });
    expect(result.current.dynamicOptions.branch?.waitingOnParent).toBe(true);
    expect(result.current.dynamicOptions.branch?.items).toHaveLength(0);
  });
});

const NO_ANSWERS: Record<string, string> = {};

describe('useDynamicQuestionOptions - category service_type (operation call)', () => {
  const CATEGORY_Q = [{
    id: 'alert_channel',
    question: 'Channel?',
    type: 'select',
    dynamic_source: { service_type: 'messaging', operation: 'list_channels' },
  }] as unknown as TransformQuestionResponse[];

  beforeEach(() => {
    discover.mockReset();
    vault.credentials = [{ id: 'cred-gh', service_type: 'github', name: 'GH' }];
  });

  it('a slack credential satisfies a "messaging" question, as the adoption banner already says', async () => {
    vault.credentials = [{ id: 'cred-slack', service_type: 'slack', name: 'Slack' }];
    discover.mockResolvedValue([{ value: 'C1', label: '#general' }]);
    const { result } = renderHook(() => useDynamicQuestionOptions(CATEGORY_Q, NO_ANSWERS));
    await waitFor(() => expect(result.current.dynamicOptions.alert_channel?.items).toHaveLength(1));
    expect(result.current.dynamicOptions.alert_channel?.errorKind).toBeNull();
    expect(discover).toHaveBeenCalledWith('cred-slack', 'slack', 'list_channels', {});
  });

  it('still reports no credential when nothing in the vault matches the category', async () => {
    const { result } = renderHook(() => useDynamicQuestionOptions(CATEGORY_Q, NO_ANSWERS));
    await waitFor(() => expect(result.current.dynamicOptions.alert_channel?.errorKind).toBe('no_credential'));
    expect(discover).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { useToastStore } from '@/stores/toastStore';

// A feature scan that fails to START must reach the operator. useUseCases used
// to catch it into an `error` field no surface reads, so the ledger's Scan
// button and the Factory's `scan().catch(toastCatch(...))` both stayed silent.

const scanUseCases = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/useCases', () => ({
  listUseCases: vi.fn(async () => []),
  scanUseCases,
  getUseCaseScanStatus: vi.fn(),
  cancelUseCaseScan: vi.fn(async () => undefined),
}));

import { LedgerActions } from '../contextLedgerShared';
import { useUseCases, type UseCasesState } from '../useUseCases';

const refusal = { error: 'Claude CLI not found on PATH', kind: 'not_found' };

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe('feature scan start failure', () => {
  it('rejects from scan() so a caller can report it', async () => {
    scanUseCases.mockRejectedValue(refusal);
    const { result } = renderHook(() => useUseCases('p-scan-start'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.scan()).rejects.toBe(refusal);
    expect(result.current.scanning).toBe(false);
  });

  it('the ledger Scan button toasts the reason', async () => {
    const state = {
      scanning: false,
      scan: vi.fn(() => Promise.reject(refusal)),
      cancelScan: vi.fn(),
    } as unknown as UseCasesState;
    render(<LedgerActions state={state} hasMap t={en.plugins.dev_tools} />);
    fireEvent.click(screen.getByText(en.plugins.dev_tools.uc_scan));
    await waitFor(() => expect(useToastStore.getState().toasts.map((x) => x.message)).toContain(refusal.error));
  });
});

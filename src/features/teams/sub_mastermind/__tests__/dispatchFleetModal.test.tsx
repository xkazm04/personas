import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));
vi.mock('@/features/shared/components/modals', () => ({
  BaseModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { DispatchFleetModal } from '../lib/DispatchFleetModal';

// The page's onDispatch reports the failure itself (toast + toastCatch) and then
// REJECTS so the modal stays open. The modal must absorb that rejection: a
// click handler's returned promise has no awaiter, so an uncaught rejection
// there becomes an unhandledrejection on every failed dispatch.
describe('DispatchFleetModal failed dispatch', () => {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => { seen.push(reason); };
  beforeEach(() => { seen.length = 0; process.on('unhandledRejection', onUnhandled); });
  afterEach(() => { process.off('unhandledRejection', onUnhandled); });

  it('stays open, re-enables the button, and leaves no unhandled rejection', async () => {
    const onDispatch = vi.fn().mockRejectedValue(new Error('spawn failed'));
    const onClose = vi.fn();
    render(<DispatchFleetModal name="repo" onDispatch={onDispatch} onClose={onClose} />);

    fireEvent.change(screen.getByTestId('mm-dispatch-input'), { target: { value: 'fix the build' } });
    fireEvent.click(screen.getByTestId('mm-dispatch-submit'));

    await waitFor(() => expect(screen.getByTestId('mm-dispatch-submit')).not.toBeDisabled());
    // Let the rejection reach the process-level hook if nothing handled it.
    await new Promise((r) => setTimeout(r, 20));

    expect(onDispatch).toHaveBeenCalledWith('fix the build');
    expect(onClose).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});

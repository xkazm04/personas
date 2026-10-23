import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const handler = vi.fn();
const toastCatchMock = vi.fn((_context: string) => handler);
vi.mock('@/lib/silentCatch', async (orig) => ({
  ...(await orig<typeof import('@/lib/silentCatch')>()),
  toastCatch: (c: string) => toastCatchMock(c),
}));

import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('surfaces a rejected onConfirm instead of leaking an unhandled rejection', async () => {
    const boom = new Error('delete failed');
    const onConfirm = vi.fn(() => Promise.reject(boom));
    render(<ConfirmDialog title="Delete?" confirmLabel="Do it" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Do it'));
    await waitFor(() => expect(handler).toHaveBeenCalledWith(boom));
    expect(toastCatchMock).toHaveBeenCalledWith(expect.stringContaining('ConfirmDialog'));
    // The dialog stays open and the button is usable again so the user can retry.
    await waitFor(() => expect(screen.getByText('Do it')).not.toBeDisabled());
  });

  it('does not report a successful confirm', async () => {
    handler.mockClear();
    const onConfirm = vi.fn(async () => {});
    render(<ConfirmDialog title="Delete?" confirmLabel="Do it" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Do it'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(handler).not.toHaveBeenCalled();
  });
});

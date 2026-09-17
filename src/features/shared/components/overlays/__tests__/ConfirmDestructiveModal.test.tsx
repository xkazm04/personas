import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDestructiveModal } from '../ConfirmDestructiveModal';

const base = {
  title: 'Delete Credential',
  message: 'This cannot be undone.',
  confirmLabel: 'Delete',
  onCancel: vi.fn(),
};

const confirmButton = () => screen.getByRole('button', { name: /Delete/ });

describe('ConfirmDestructiveModal', () => {
  it('runs one confirm at a time and stays busy until the promise settles', async () => {
    let release!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<ConfirmDestructiveModal open config={{ ...base, onConfirm }} />);

    const btn = confirmButton();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(confirmButton().getAttribute('aria-busy')).toBe('true'));
    expect(confirmButton().hasAttribute('disabled')).toBe(true);

    release();
    // React omits aria-busy entirely when false, so "settled" is the absence.
    await waitFor(() => expect(confirmButton().getAttribute('aria-busy')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed confirmation when the action throws', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('boom')));
    render(
      <ConfirmDestructiveModal
        open
        config={{ ...base, requireTypedConfirmation: 'prod-key', onConfirm }}
      />,
    );
    const input = screen.getByPlaceholderText('prod-key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'prod-key' } });
    expect(confirmButton().hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // Still open, still typed: the user can retry without retyping the name.
    await waitFor(() => expect(confirmButton().hasAttribute('disabled')).toBe(false));
    expect((screen.getByPlaceholderText('prod-key') as HTMLInputElement).value).toBe('prod-key');
  });

  it('clears the typed confirmation once the action resolves', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(
      <ConfirmDestructiveModal
        open
        config={{ ...base, requireTypedConfirmation: 'prod-key', onConfirm }}
      />,
    );
    const input = screen.getByPlaceholderText('prod-key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'prod-key' } });
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect((screen.getByPlaceholderText('prod-key') as HTMLInputElement).value).toBe(''),
    );
  });
});

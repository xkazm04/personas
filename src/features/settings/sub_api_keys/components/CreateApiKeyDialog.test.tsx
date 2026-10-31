/**
 * While a key is being minted the dialog's Cancel and X are disabled; the
 * backdrop must hold the same rule, or a failed create reports into a dialog
 * that is already gone. The icon-only X needs an accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./ExecutePersonaPicker', () => ({ ExecutePersonaPicker: () => null }));

import { CreateApiKeyDialog } from './CreateApiKeyDialog';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('CreateApiKeyDialog', () => {
  it('ignores a backdrop click while the key is being created', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    const { container } = render(<CreateApiKeyDialog onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/Claude Desktop/), { target: { value: 'ci-bot' } });
    fireEvent.click(screen.getByText('Generate key'));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    fireEvent.click(container.firstChild as Element);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a backdrop click closes it when idle', () => {
    const onClose = vi.fn();
    const { container } = render(<CreateApiKeyDialog onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names its close button', () => {
    render(<CreateApiKeyDialog onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeNull();
  });

  it('binds its labels to their controls', () => {
    render(<CreateApiKeyDialog onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Name')).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Scopes' })).not.toBeNull();
    expect(screen.queryByRole('group', { name: 'Expires' })).not.toBeNull();
  });
});

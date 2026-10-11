import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DisconnectDialog } from '../DisconnectDialog';

vi.mock('@/i18n/useTranslation', async () => {
  const { default: t } = await import('@/i18n/locales/en.json');
  return { useTranslation: () => ({ t }) };
});

function renderOpen() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DisconnectDialog open personaName="Scout" eventLabel="build_failed" onConfirm={onConfirm} onCancel={onCancel} />,
  );
  return { onConfirm, onCancel };
}

describe('DisconnectDialog on the modal host', () => {
  it('announces itself as a labelled dialog', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('Disconnect persona?');
  });

  it('cancels on Escape', () => {
    const { onCancel, onConfirm } = renderOpen();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('names the close control and confirms through the translated action', () => {
    const { onCancel, onConfirm } = renderOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(<DisconnectDialog open={false} personaName="Scout" eventLabel="x" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/**
 * Reset wipes the SQL transcript and there is no undo for it anywhere in the
 * product. The control sits in a strip of cheap, reversible toggles, so a
 * slip on the wrong icon used to destroy the thread outright.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import en from '@/i18n/locales/en.json';

vi.mock('../athenaChatActions', () => ({
  resetConversation: vi.fn(async () => {}),
  setAutonomousMode: vi.fn(),
  setDevMode: vi.fn(),
}));
// The switcher, the autonomy option and the dev-only buttons reach the
// companion backend; the header's reset affordance is what is under test.
vi.mock('../../ConversationSwitcher', () => ({ ConversationSwitcher: () => null }));
vi.mock('../AthenaChatSleepButton', () => ({ AthenaChatSleepButton: () => null }));
vi.mock('../AthenaAutonomyOption', () => ({ AthenaAutonomyOption: () => null }));

import { AthenaChatHeader } from '../AthenaChatHeader';
import { resetConversation } from '../athenaChatActions';

const mockReset = resetConversation as ReturnType<typeof vi.fn>;

const mount = () => render(<AthenaChatHeader />);

beforeEach(() => {
  mockReset.mockClear();
});

describe('companion header reset', () => {
  it('does not reset on the click alone - it asks first', () => {
    mount();
    fireEvent.click(screen.getByTestId('companion-reset'));
    expect(mockReset).not.toHaveBeenCalled();
    expect(screen.getByText(en.plugins.companion.reset_confirm_title)).toBeTruthy();
  });

  it('cancel leaves the transcript alone', () => {
    mount();
    fireEvent.click(screen.getByTestId('companion-reset'));
    fireEvent.click(screen.getByText(en.common.cancel));
    expect(mockReset).not.toHaveBeenCalled();
    expect(screen.queryByText(en.plugins.companion.reset_confirm_title)).toBeNull();
  });

  it('confirm clears it', async () => {
    mount();
    fireEvent.click(screen.getByTestId('companion-reset'));
    fireEvent.click(screen.getByText(en.plugins.companion.reset_confirm_action));
    await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('companion-reset-confirm')).toBeNull());
  });

  it('asks in an anchored popover (the shared ConfirmPopover), not a modal', () => {
    mount();
    fireEvent.click(screen.getByTestId('companion-reset'));
    const dialog = screen.getByTestId('companion-reset-confirm');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveTextContent(en.plugins.companion.reset_confirm_body);
    // Irreversible: focus starts on Cancel, not on the destructive action.
    expect(document.activeElement).toHaveTextContent(en.common.cancel);
  });

  it('Escape and a press outside both close it without resetting', () => {
    mount();
    fireEvent.click(screen.getByTestId('companion-reset'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('companion-reset-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('companion-reset'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('companion-reset-confirm')).toBeNull();
    expect(mockReset).not.toHaveBeenCalled();
  });
});

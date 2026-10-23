import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const acceptGoal = vi.fn().mockResolvedValue(undefined);
const rejectGoal = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ acceptGoal, rejectGoal }),
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        dev_tools: { your_turn: 'Your turn', agents_turn: "Agent's turn", done: 'Done' },
        dev_lifecycle: {
          accept_accept: 'Accept',
          accept_send_back: 'Send back',
          accept_cancel: 'Cancel',
          accept_send_back_placeholder: 'Why',
          goal_status_open: 'Open',
          goal_status_in_progress: 'In progress',
          goal_status_awaiting_acceptance: 'Awaiting acceptance',
          goal_status_blocked: 'Blocked',
          goal_status_done: 'Done',
        },
      },
    },
    language: 'en',
  }),
}));

import { LedgerStatusCell } from '../LedgerStatusCell';

describe('LedgerStatusCell', () => {
  it('awaiting_acceptance renders Accept / Send back; accept does not reach the row', () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <LedgerStatusCell goalId="g1" status="awaiting_acceptance" />
      </div>,
    );
    expect(screen.getByLabelText('Your turn')).toBeTruthy();
    fireEvent.click(screen.getByText('Accept'));
    expect(acceptGoal).toHaveBeenCalledWith('g1');
    expect(rowClick).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Send back')).toBeTruthy();
  });

  it('other statuses show the glyph but no controls', () => {
    render(<LedgerStatusCell goalId="g2" status="in-progress" />);
    expect(screen.getByLabelText("Agent's turn")).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
  });
});

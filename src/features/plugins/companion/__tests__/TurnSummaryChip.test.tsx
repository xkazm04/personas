import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TurnSummaryChip, type TurnSummaryJumpTarget } from '../TurnSummaryChip';
import type { StoredTurnSummary } from '../companionStore';

function summary(over: Partial<StoredTurnSummary> = {}): StoredTurnSummary {
  return {
    approvals: 0,
    navigations: 0,
    labOpens: 0,
    dashboards: 0,
    cockpits: 0,
    chatCards: 0,
    continuation: false,
    ...over,
  };
}

describe('TurnSummaryChip', () => {
  it('renders nothing when every count is zero and continuation=false', () => {
    const { container } = render(<TurnSummaryChip summary={summary()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single chip when navigations=1', () => {
    render(<TurnSummaryChip summary={summary({ navigations: 1 })} />);
    expect(
      screen.getByTestId('companion-turn-summary-chip'),
    ).toBeInTheDocument();
    expect(screen.getByText(/navigated/i)).toBeInTheDocument();
  });

  it('renders × N suffix when count > 1', () => {
    render(<TurnSummaryChip summary={summary({ approvals: 3 })} />);
    expect(screen.getByText(/× 3/)).toBeInTheDocument();
  });

  it('combines multiple side-effects with dot separators', () => {
    render(
      <TurnSummaryChip
        summary={summary({ approvals: 2, navigations: 1, dashboards: 1 })}
      />,
    );
    const dots = screen.getAllByText('·');
    // 3 chip groups → 2 separators
    expect(dots.length).toBe(2);
  });

  it('surfaces continuation flag even with zero side-effects', () => {
    render(<TurnSummaryChip summary={summary({ continuation: true })} />);
    expect(
      screen.getByTestId('companion-turn-summary-chip'),
    ).toBeInTheDocument();
    expect(screen.getByText(/continue/i)).toBeInTheDocument();
  });

  it('renders parts as plain spans when onJump is not provided', () => {
    render(
      <TurnSummaryChip
        summary={summary({ approvals: 1, dashboards: 1, navigations: 1 })}
      />,
    );
    expect(
      screen.queryByTestId('companion-turn-summary-jump-approvals'),
    ).toBeNull();
    expect(
      screen.queryByTestId('companion-turn-summary-jump-dashboard'),
    ).toBeNull();
  });

  it('renders interactive parts as buttons when onJump is provided', () => {
    const onJump = vi.fn();
    render(
      <TurnSummaryChip
        summary={summary({
          approvals: 1,
          chatCards: 1,
          dashboards: 1,
          cockpits: 1,
          // nav / lab / continuation stay non-clickable even with onJump
          navigations: 1,
          labOpens: 1,
          continuation: true,
        })}
        onJump={onJump}
      />,
    );
    expect(
      screen.getByTestId('companion-turn-summary-jump-approvals'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('companion-turn-summary-jump-chatCards'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('companion-turn-summary-jump-dashboard'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('companion-turn-summary-jump-cockpit'),
    ).toBeInTheDocument();
    // No buttons should exist for nav / lab / continuation.
    const allButtons = screen.getAllByRole('button');
    expect(allButtons).toHaveLength(4);
  });

  it('forwards the right target when a clickable part is clicked', () => {
    const targets: TurnSummaryJumpTarget[] = [];
    render(
      <TurnSummaryChip
        summary={summary({ approvals: 1, chatCards: 1, dashboards: 1, cockpits: 1 })}
        onJump={(t) => targets.push(t)}
      />,
    );
    fireEvent.click(screen.getByTestId('companion-turn-summary-jump-approvals'));
    fireEvent.click(screen.getByTestId('companion-turn-summary-jump-chatCards'));
    fireEvent.click(screen.getByTestId('companion-turn-summary-jump-dashboard'));
    fireEvent.click(screen.getByTestId('companion-turn-summary-jump-cockpit'));
    expect(targets).toEqual(['approvals', 'chatCards', 'dashboard', 'cockpit']);
  });
});

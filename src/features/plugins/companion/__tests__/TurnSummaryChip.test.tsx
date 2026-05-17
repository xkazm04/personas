import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnSummaryChip } from '../TurnSummaryChip';
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
});

/**
 * GridHeader — the Activity strip's two controls over what the board shows.
 *
 * `AutopilotSwitch` and the simulation toggle are stubbed: both reach the
 * backend, and neither has anything to do with the claim under test, which is
 * that the tally pills are doors rather than labels — pressed state, a pick,
 * and a second click on the pressed pill that clears it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SquareState } from '../../fleetGridModel';

vi.mock('../AutopilotSwitch', () => ({ AutopilotSwitch: () => null }));
vi.mock('../../simulation', () => ({ SimulationToggle: () => null }));

import { GridHeader } from '../GridHeader';

const TOTALS: Record<SquareState, number> = { running: 2, attention: 6, failed: 1, idle: 30 };

function renderHeader(over: Partial<Parameters<typeof GridHeader>[0]> = {}) {
  const onPickState = vi.fn();
  render(
    <GridHeader
      totals={TOTALS}
      showTally
      stateFilter={null}
      onPickState={onPickState}
      {...over}
    />,
  );
  return { onPickState };
}

describe('GridHeader tally pills', () => {
  it('renders every state as a pressable control, not a span', () => {
    renderHeader();
    for (const s of ['running', 'attention', 'failed', 'idle'] as const) {
      const pill = screen.getByTestId(`fleet-grid-tally-${s}`);
      expect(pill.tagName).toBe('BUTTON');
      expect(pill).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('carries the count it filters to', () => {
    renderHeader();
    expect(screen.getByTestId('fleet-grid-tally-attention')).toHaveTextContent('6');
  });

  it('picks a state on click', async () => {
    const { onPickState } = renderHeader();
    await userEvent.click(screen.getByTestId('fleet-grid-tally-attention'));
    expect(onPickState).toHaveBeenCalledWith('attention');
  });

  it('marks the active pill pressed and leaves the others alone', () => {
    renderHeader({ stateFilter: 'failed' });
    expect(screen.getByTestId('fleet-grid-tally-failed')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('fleet-grid-tally-attention')).toHaveAttribute('aria-pressed', 'false');
  });

  it('sends the same state again so the host can clear it', async () => {
    const { onPickState } = renderHeader({ stateFilter: 'failed' });
    await userEvent.click(screen.getByTestId('fleet-grid-tally-failed'));
    expect(onPickState).toHaveBeenCalledWith('failed');
  });

  it('shows no tally at all before the first read lands', () => {
    renderHeader({ showTally: false });
    expect(screen.queryByTestId('fleet-grid-tally')).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NegotiatorIdlePhase } from '../NegotiatorPhases';

/**
 * The panel has always computed which already-authenticated services match the
 * connector and handed them to the step graph, which skips the sign-in steps.
 * The idle screen never read that list: a user whose `gh auth status` was
 * already good still met a generic "Start auto-provisioning" and a two-minute
 * estimate for work that had mostly already happened.
 */

function idle(matchedAuth?: { serviceType: string; method: string }[], loading = false) {
  render(
    <NegotiatorIdlePhase
      connectorLabel="GitHub"
      authDetectLoading={loading}
      onStart={vi.fn()}
      matchedAuth={matchedAuth}
    />,
  );
  return screen.getByTestId('vault-negotiator-start');
}

describe('NegotiatorIdlePhase — route a live session to itself', () => {
  it('offers the existing session as the primary action when one matches', () => {
    const button = idle([{ serviceType: 'github', method: 'gh CLI' }]);
    expect(button.textContent).toContain('existing');
    expect(button.textContent).toContain('GitHub');
    // The estimate describes a full guided capture, which this is not.
    expect(screen.queryByText(/Takes ~/)).toBeNull();
    expect(screen.getByText(/already signed in/i).textContent).toContain('gh CLI');
  });

  it('is unchanged with no match', () => {
    const button = idle([]);
    expect(button.textContent).toContain('Start auto-provisioning');
    expect(screen.getByText(/Takes ~2 minutes/)).toBeTruthy();
  });

  it('does not promise a session while detection is still running', () => {
    // A detect that has not answered yet must not paint either verdict.
    const button = idle([{ serviceType: 'github', method: 'gh CLI' }], true);
    expect(button.textContent).toContain('Detecting existing auth');
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});

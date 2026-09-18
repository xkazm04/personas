import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthcheckResultDisplay } from '../HealthcheckResultDisplay';

/**
 * A probe has four outcomes and this display had two.
 *
 * Keying on `success` alone meant `unverifiable` -- the connector exposes no
 * live probe, which the backend deliberately returns as `success: true` --
 * drew the green check and claimed a verification nothing performed, while
 * `unreachable` (DNS, timeout, airplane mode) drew the red error and read as
 * "your key is wrong", which is how a good API key gets regenerated.
 */

function state(props: { success: boolean; message?: string; state?: string | null }) {
  render(<HealthcheckResultDisplay message="probe message" {...props} />);
  return screen.getByTestId('healthcheck-result').getAttribute('data-state');
}

describe('HealthcheckResultDisplay — three treatments, not two', () => {
  it('paints a real pass green', () => {
    expect(state({ success: true, state: 'verified' })).toBe('verified');
  });

  it('does not claim a verification for a connector with no probe', () => {
    // success is TRUE here (HealthcheckResult::unverifiable), which is exactly
    // why the boolean could never have told these two apart.
    expect(state({ success: true, state: 'unverifiable' })).toBe('unverifiable');
  });

  it('does not blame the credential when the service was never reached', () => {
    expect(state({ success: false, state: 'unreachable' })).toBe('unreachable');
  });

  it('still paints a rejected key red', () => {
    expect(state({ success: false, state: 'failed' })).toBe('failed');
  });

  it('falls back to the boolean for a legacy passing result with no state', () => {
    expect(state({ success: true })).toBe('verified');
  });

  it('falls back to the boolean for a legacy failing result with no state', () => {
    expect(state({ success: false })).toBe('failed');
  });
});

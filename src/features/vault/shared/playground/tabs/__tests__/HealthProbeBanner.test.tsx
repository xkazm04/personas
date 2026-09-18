import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { HealthProbeBanner, resolveProbeState } from '../HealthProbeBanner';

/**
 * A probe has three outcomes. The banner used to paint OK/FAIL from a boolean,
 * so a timeout or an unreachable host rendered exactly like a rejected key --
 * the failure mode the health-probing technique exists to prevent, because it
 * turns red into noise and gets good credentials rotated.
 */
function result(over: Partial<HealthResult> = {}): HealthResult {
  return { success: true, message: 'probe message', ...over };
}

describe('HealthProbeBanner', () => {
  it('renders a verified probe as its own state', () => {
    render(<HealthProbeBanner result={result({ state: 'verified' })} />);
    expect(screen.getByTestId('health-probe-banner').getAttribute('data-state')).toBe('verified');
  });

  it('renders an unverifiable probe as unknown, not as a failure', () => {
    render(<HealthProbeBanner result={result({ success: false, state: 'unverifiable' })} />);
    const banner = screen.getByTestId('health-probe-banner');
    expect(banner.getAttribute('data-state')).toBe('unverifiable');
    expect(banner.className).not.toContain('red');
  });

  it('renders a failed probe in the red treatment with the provider message', () => {
    render(
      <HealthProbeBanner result={result({ success: false, state: 'failed', message: '401 invalid key' })} />,
    );
    const banner = screen.getByTestId('health-probe-banner');
    expect(banner.getAttribute('data-state')).toBe('failed');
    expect(banner.className).toContain('red');
    expect(screen.getByText('401 invalid key')).toBeTruthy();
  });

  it('offers a retry only on the unverifiable state', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <HealthProbeBanner result={result({ success: false, state: 'unverifiable' })} onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByTestId('health-probe-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<HealthProbeBanner result={result({ success: false, state: 'failed' })} onRetry={onRetry} />);
    expect(screen.queryByTestId('health-probe-retry')).toBeNull();
  });

  it('labels a persisted result as stored rather than presenting it as live', () => {
    render(<HealthProbeBanner result={result({ isStale: true })} />);
    expect(screen.getByTestId('health-probe-stale')).toBeTruthy();
  });

  // `unreachable` reaches the renderer since sweep #27/#28 -- it was
  // unrepresentable in TS before that, so it fell through to the boolean and
  // an offline laptop's good key drew the same red as a rejected one.
  it('gives an unreachable probe the no-verdict treatment, not the failure one', () => {
    render(<HealthProbeBanner result={result({ success: false, state: 'unreachable' })} />);
    expect(screen.getByTestId('health-probe-banner').getAttribute('data-state')).toBe('unreachable');
  });

  it('offers retry for unreachable, since asking again is the only way to learn', () => {
    render(
      <HealthProbeBanner result={result({ success: false, state: 'unreachable' })} onRetry={vi.fn()} />,
    );
    expect(screen.getByTestId('health-probe-retry')).toBeTruthy();
  });

  describe('resolveProbeState', () => {
    it('prefers the typed state over the boolean', () => {
      expect(resolveProbeState(result({ success: true, state: 'unverifiable' }))).toBe('unverifiable');
      expect(resolveProbeState(result({ success: true, state: 'failed' }))).toBe('failed');
      expect(resolveProbeState(result({ success: false, state: 'unreachable' }))).toBe('unreachable');
    });

    it('falls back to the boolean for legacy/persisted results with no state', () => {
      expect(resolveProbeState(result({ success: true }))).toBe('verified');
      expect(resolveProbeState(result({ success: false }))).toBe('failed');
      expect(resolveProbeState(result({ success: true, state: null }))).toBe('verified');
    });
  });
});

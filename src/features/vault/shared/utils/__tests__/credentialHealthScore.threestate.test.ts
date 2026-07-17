import { describe, it, expect } from 'vitest';
import { computeHealthScore } from '../credentialHealthScore';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';

const hr = (state: HealthResult['state'], success: boolean): HealthResult => ({
  success,
  message: 'm',
  state,
});

describe('composite health three-state (wave-13 carry-in)', () => {
  it('verified scores full healthcheck weight', () => {
    const c = computeHealthScore(hr('verified', true), null);
    expect(c.score).toBe(100);
    expect(c.tier).toBe('healthy');
  });

  it('unverifiable is neutral, not healthy(100), and says why', () => {
    const c = computeHealthScore(hr('unverifiable', true), null);
    // hc 50 * 0.4 + anomaly 100 * 0.4 + rotation 100 * 0.2 = 80
    expect(c.score).toBe(80);
    expect(c.reason).toBe('No live probe exists for this connector');
    expect(c.worstSignal).toBe('healthcheck');
  });

  it('failed scores zero for the healthcheck signal', () => {
    const c = computeHealthScore(hr('failed', false), null);
    expect(c.worstSignal).toBe('healthcheck');
    expect(c.reason).toBe('Healthcheck failing');
  });

  it('legacy result without state falls back to the boolean', () => {
    const legacy: HealthResult = { success: true, message: 'm' };
    expect(computeHealthScore(legacy, null).score).toBe(100);
  });
});

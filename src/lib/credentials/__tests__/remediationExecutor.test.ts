import { describe, it, expect, vi, beforeEach } from 'vitest';

// The rotation wrappers go through invokeWithTimeout, which rejects with a
// serialized AppError OBJECT, never an Error.
const appError = { error: 'Provider refused the new key: 403', kind: 'Forbidden' };

vi.mock('@/api/vault/rotation', () => ({
  rotateCredentialNow: vi.fn(() => Promise.reject(appError)),
  listRotationPolicies: vi.fn(() => Promise.reject(appError)),
  updateRotationPolicy: vi.fn(),
}));

const sendOsNotification = vi.fn(() => Promise.resolve());
vi.mock('@/lib/utils/platform/osNotification', () => ({ sendOsNotification }));

const { executeRemediationAction } = await import('../remediationExecutor');
const { remediationBus } = await import('../remediationBus');

function dispatch(action: 'auto_rotate' | 'auto_disable') {
  const event = remediationBus.dispatch({
    credentialId: `cred-${action}`,
    credentialName: 'Stripe',
    action,
    remediation: 'RotateThenAlert',
    reason: 'test',
    anomalyScore: null,
  });
  if (!event) throw new Error('dispatch was deduplicated');
  return event;
}

describe('remediationExecutor reports the backend reason of an IPC refusal', () => {
  beforeEach(() => {
    remediationBus.resetCooldowns();
    remediationBus.clearLog();
    sendOsNotification.mockClear();
  });

  it('auto_rotate: outcome and OS notification carry the AppError text', async () => {
    const event = dispatch('auto_rotate');
    await executeRemediationAction(event);
    const logged = remediationBus.log.find((e) => e.id === event.id);
    expect(logged?.outcome).toBe('failed');
    expect(logged?.outcomeDetail).toBe(appError.error);
    expect(sendOsNotification).toHaveBeenCalledWith('Credential Rotation Failed', `Stripe: ${appError.error}`);
  });

  it('auto_disable: outcome carries the AppError text', async () => {
    const event = dispatch('auto_disable');
    await executeRemediationAction(event);
    const logged = remediationBus.log.find((e) => e.id === event.id);
    expect(logged?.outcome).toBe('failed');
    expect(logged?.outcomeDetail).toBe(appError.error);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RotationStatus } from '@/api/vault/rotation';

/**
 * invokeWithTimeout rejects with the serialized AppError OBJECT, never an
 * Error. The rotation controls read `err instanceof Error ? err.message :
 * 'Unknown error'`, so every backend reason ("already being rotated", a
 * provider refusal) reached the user as "Rotation failed: Unknown error".
 */
const ipcError = { error: 'Credential cred-1 is already being rotated', kind: 'execution' };

vi.mock('@/api/vault/rotation', () => ({
  rotateCredentialNow: vi.fn(() => Promise.reject(ipcError)),
  createRotationPolicy: vi.fn(() => Promise.reject(ipcError)),
  listRotationPolicies: vi.fn(() => Promise.reject(ipcError)),
  deleteRotationPolicy: vi.fn(),
  updateRotationPolicy: vi.fn(),
}));

import { RotationActivePolicy } from '../RotationActivePolicy';
import { RotationNewPolicy } from '../RotationNewPolicy';

const status: RotationStatus = {
  has_policy: true,
  policy_enabled: true,
  rotation_interval_days: 90,
  next_rotation_at: null,
  last_rotated_at: null,
  last_status: null,
  policy_type: 'scheduled',
  anomaly_detected: false,
  consecutive_failures: 0,
  recent_history: [],
  anomaly_score: null,
  anomaly_tolerance: 0.8,
  healthcheck_corrupted: false,
};

describe('rotation controls surface the backend reason', () => {
  let onError: ReturnType<typeof vi.fn<(m: string | null) => void>>;
  beforeEach(() => { onError = vi.fn(); });

  function lastMessage(): string {
    const calls = onError.mock.calls.map((c) => c[0]).filter((m): m is string => !!m);
    return calls[calls.length - 1] ?? '';
  }

  it('Rotate now', async () => {
    render(
      <RotationActivePolicy credentialId="cred-1" rotationStatus={status} rotationCountdown={null}
        onRefresh={async () => {}} onHealthcheck={() => {}} onError={onError} />,
    );
    fireEvent.click(screen.getByTestId('rotation-rotate-now-btn'));
    await waitFor(() => expect(lastMessage()).toContain('already being rotated'));
    expect(lastMessage()).not.toContain('Unknown error');
  });

  it('Remove policy', async () => {
    render(
      <RotationActivePolicy credentialId="cred-1" rotationStatus={status} rotationCountdown={null}
        onRefresh={async () => {}} onHealthcheck={() => {}} onError={onError} />,
    );
    fireEvent.click(screen.getByTestId('rotation-delete-policy-btn'));
    await waitFor(() => expect(lastMessage()).toContain('already being rotated'));
  });

  it('Enable rotation', async () => {
    render(
      <RotationNewPolicy credentialId="cred-1" initialDays={90} onRefresh={async () => {}} onError={onError} />,
    );
    fireEvent.click(screen.getByTestId('rotation-enable-btn'));
    await waitFor(() => expect(lastMessage()).toContain('already being rotated'));
  });
});

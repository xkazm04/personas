import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import type { AppPassport } from '../../passportModel';
import { MonitoringModal } from '../MonitoringModal';

// A binding row survives the credential it names: the vault no longer has
// `cred-deleted`, but `dev_project_env_connectors` still points at it.
vi.mock('@/api/devTools/devTools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/devTools/devTools')>()),
  listEnvConnectors: vi.fn(async () => [{
    projectId: 'p1', dimension: 'monitoring', env: 'production', credentialId: 'cred-deleted',
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  }]),
}));
vi.mock('@/api/vault/credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/vault/credentials')>()),
  listCredentials: vi.fn(async () => []),
  healthcheckCredential: vi.fn(async () => ({ success: true })),
}));

// Only the fields the four monitoring items read: nothing detected anywhere.
const passport = {
  stack: { monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null }, llmTracking: null },
} as AppPassport;

describe('MonitoringModal', () => {
  it('an unresolvable binding does not offer the Implement action that cannot run', async () => {
    const { getByTestId } = render(<MonitoringModal slug="p1" projectName="Proj" passport={passport} onClose={vi.fn()} />);
    const card = await waitFor(() => getByTestId('monitoring-card-monitoring'));
    // Let both fetches settle (the binding row arrives, the vault is empty).
    const { listEnvConnectors } = await import('@/api/devTools/devTools');
    await waitFor(() => expect(listEnvConnectors).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    // NOT_IMPLEMENTED renders the Rocket "Implement with Claude" action, whose
    // handler returns early on `!row.bound`: a dead button.
    expect(card.querySelector('.lucide-rocket')).toBeNull();
  });
});

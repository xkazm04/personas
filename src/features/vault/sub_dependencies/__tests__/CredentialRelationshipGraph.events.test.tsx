import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const invokeWithTimeout = vi.fn();
vi.mock('@/lib/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauriInvoke')>()),
  invokeWithTimeout: (...a: unknown[]) => invokeWithTimeout(...a),
}));

import { useVaultStore } from '@/stores/vaultStore';
import { useAgentStore } from '@/stores/agentStore';
import type { CredentialMetadata, CredentialEvent } from '@/lib/types/types';
import { CredentialRelationshipGraph } from '../CredentialRelationshipGraph';

/**
 * Event nodes are part of the graph, the Events filter tile and the blast
 * radius. They used to be fetched one credential at a time on CLICK, so the
 * graph opened with zero event nodes, the Events tile read 0, and an
 * events-only credential first opened its panel as "minimal impact".
 */

const cred = {
  id: 'cred-1',
  name: 'Stripe key',
  service_type: 'stripe',
  healthcheck_last_success: true,
} as CredentialMetadata;

const event = {
  id: 'evt-1',
  credential_id: 'cred-1',
  name: 'Payment hook',
  enabled: true,
} as CredentialEvent;

describe('CredentialRelationshipGraph event nodes', () => {
  beforeEach(() => {
    invokeWithTimeout.mockReset();
    invokeWithTimeout.mockImplementation(async (cmd: string) => {
      if (cmd === 'credential_dependents_all') return {};
      if (cmd === 'list_all_credential_events') return [event];
      if (cmd === 'list_credential_events') return [event];
      return undefined;
    });
    useVaultStore.setState({ credentials: [cred], connectorDefinitions: [] });
    useAgentStore.setState({ personas: [] });
  });

  it('draws every credential event on open, without a click', async () => {
    render(<CredentialRelationshipGraph />);
    await waitFor(() => expect(screen.getByText('Payment hook')).toBeTruthy());
  });
});

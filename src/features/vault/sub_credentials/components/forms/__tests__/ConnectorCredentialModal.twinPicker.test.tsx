import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConnectorCredentialModal } from '../ConnectorCredentialModal';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { SuggestedConnector } from '@/lib/types/designTypes';

/**
 * A failed twin-profile load used to vanish into silentCatch: the picker was
 * just empty, with no reason. The modal now says why.
 */

vi.mock('@/features/vault/shared/hooks/health/useCredentialHealth', () => ({
  useCredentialHealth: () => ({
    result: null,
    isHealthchecking: false,
    checkDesign: vi.fn(),
    invalidate: vi.fn(),
  }),
}));
vi.mock('@/api/twin/twin', () => ({
  listProfiles: vi.fn(async () => {
    throw { error: 'twin store offline', kind: 'Internal' };
  }),
}));

const connector = { name: 'twin' } as unknown as SuggestedConnector;
const definition = {
  id: 'def-twin',
  name: 'twin',
  label: 'Twin',
  category: 'api',
  color: '#fff',
  fields: [{ key: 'twin_profile_id', label: 'Profile', type: 'select', required: true }],
  services: [],
  events: [],
  healthcheck_config: null,
  metadata: { requires_picker: 'twin' },
} as unknown as ConnectorDefinition;

describe('ConnectorCredentialModal twin picker', () => {
  it('shows an alert when the profile list fails to load', async () => {
    render(
      <ConnectorCredentialModal
        connector={connector}
        connectorDefinition={definition}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('twin-picker-load-error')).toBeTruthy());
  });
});

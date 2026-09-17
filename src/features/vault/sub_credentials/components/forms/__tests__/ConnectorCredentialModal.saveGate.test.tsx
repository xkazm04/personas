import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectorCredentialModal } from '../ConnectorCredentialModal';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { SuggestedConnector } from '@/lib/types/designTypes';

/**
 * Save is gated on a passing probe only when a probe RECIPE exists.
 *
 * The gate used to read `connectorDefinition ? healthcheck_config != null :
 * true`, which switched ON for the one case the comment above it promised to
 * exempt: a connector suggested by the design or import flow, which arrives
 * with no catalog row at all. Setup could not complete -- Save stayed disabled
 * behind a "Test connection" the catalog never declared a way to run.
 */

vi.mock('@/features/vault/shared/hooks/health/useCredentialHealth', () => ({
  useCredentialHealth: () => ({
    result: null,
    isHealthchecking: false,
    checkDesign: vi.fn(),
    invalidate: vi.fn(),
  }),
}));
vi.mock('@/api/twin/twin', () => ({ listProfiles: vi.fn(async () => []) }));

const connector: SuggestedConnector = {
  name: 'acme_api',
  credential_fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
} as unknown as SuggestedConnector;

function definition(healthcheck_config: string | null): ConnectorDefinition {
  return {
    id: 'def-1',
    name: 'acme_api',
    label: 'Acme',
    category: 'api',
    color: '#fff',
    fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
    services: [],
    events: [],
    healthcheck_config,
    metadata: null,
  } as unknown as ConnectorDefinition;
}

function saveButton(connectorDefinition?: ConnectorDefinition) {
  render(
    <ConnectorCredentialModal
      connector={connector}
      connectorDefinition={connectorDefinition}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return screen.getByTestId('vault-schema-save') as HTMLButtonElement;
}

describe('ConnectorCredentialModal — the save gate follows the probe recipe', () => {
  it('gates save when the catalog declared a healthcheck', () => {
    expect(saveButton(definition('{"method":"GET","url":"https://acme.test/me"}')).disabled).toBe(true);
  });

  it('does not gate save when the catalog row declares no healthcheck', () => {
    expect(saveButton(definition(null)).disabled).toBe(false);
  });

  it('does not gate save for a suggested connector with no catalog row at all', () => {
    expect(saveButton(undefined).disabled).toBe(false);
  });
});

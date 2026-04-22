import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateFormBody } from '../TemplateFormBody';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';

function makeConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  return {
    name: 'personas_messages',
    label: 'Local Messaging',
    category: 'messaging',
    color: '#6366F1',
    icon_url: '',
    fields: [],
    healthcheck_config: null,
    services: [],
    events: [],
    metadata: { auth_type: 'none' },
    ...overrides,
  } as ConnectorDefinition;
}

function renderWith(
  connector: ConnectorDefinition,
  variantFields: CredentialTemplateField[],
  spies: { onCancel?: () => void; onCreateCredential?: (v: Record<string, string>) => void } = {},
) {
  const onCancel = spies.onCancel ?? vi.fn();
  const onCreateCredential = spies.onCreateCredential ?? vi.fn();
  render(
    <TemplateFormBody
      selectedConnector={connector}
      credentialName=""
      onCredentialNameChange={() => {}}
      variantFields={variantFields}
      variants={null}
      activeVariantId={null}
      onVariantChange={() => {}}
      isAnyOAuth={false}
      isAuthorizingOAuth={false}
      oauthCompletedAt={null}
      onCreateCredential={onCreateCredential}
      onOAuthConsent={() => {}}
      onCancel={onCancel}
      onValuesChanged={() => {}}
      saveDisabled={false}
    />,
  );
  return { onCancel, onCreateCredential };
}

describe('TemplateFormBody — CONN-04 zero-config empty-state', () => {
  it('renders the "No configuration required" banner for personas_messages (auth_type: "none", fields: [])', () => {
    renderWith(makeConnector(), []);
    expect(screen.getByText('No configuration required')).toBeInTheDocument();
    expect(screen.queryByText('Credential Name')).not.toBeInTheDocument();
  });

  it('renders the empty-state when metadata.auth_type is "builtin" (not just "none")', () => {
    renderWith(makeConnector({ metadata: { auth_type: 'builtin' } }), []);
    expect(screen.getByText('No configuration required')).toBeInTheDocument();
  });

  it('renders the empty-state for arxiv too — proving the guard is connector-agnostic, not personas_messages-specific', () => {
    renderWith(makeConnector({ name: 'arxiv', label: 'arXiv', category: 'research' }), []);
    expect(screen.getByText('No configuration required')).toBeInTheDocument();
    expect(screen.queryByText('Credential Name')).not.toBeInTheDocument();
  });

  it('falls back to the normal credential form when variantFields has at least one field', () => {
    const field = { key: 'api_key', label: 'API Key', kind: 'secret' } as unknown as CredentialTemplateField;
    renderWith(makeConnector(), [field]);
    expect(screen.getByText('Credential Name')).toBeInTheDocument();
    expect(screen.queryByText('No configuration required')).not.toBeInTheDocument();
  });

  it('falls back to the normal credential form when metadata.auth_type is "oauth" (even with variantFields: [])', () => {
    renderWith(makeConnector({ metadata: { auth_type: 'oauth' } }), []);
    expect(screen.getByText('Credential Name')).toBeInTheDocument();
    expect(screen.queryByText('No configuration required')).not.toBeInTheDocument();
  });

  it('T-18-01: Done button calls onCancel and does NOT call onCreateCredential (prevents duplicate row)', () => {
    const { onCancel, onCreateCredential } = renderWith(makeConnector(), []);
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreateCredential).not.toHaveBeenCalled();
  });
});

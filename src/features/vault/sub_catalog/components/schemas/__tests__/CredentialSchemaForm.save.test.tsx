import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SchemaFormConfig } from '../schemaFormTypes';

const store = {
  createCredential: vi.fn(),
  createConnectorDefinition: vi.fn(),
  deleteConnectorDefinition: vi.fn(),
  fetchCredentials: vi.fn(),
  fetchConnectorDefinitions: vi.fn(),
};

vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: typeof store) => unknown) => sel(store),
}));

vi.mock('@/features/vault/shared/hooks/health/useCredentialHealth', () => ({
  useCredentialHealth: () => ({
    invalidate: vi.fn(),
    check: vi.fn(),
    checkDesign: vi.fn(),
    result: null,
    isHealthchecking: false,
  }),
}));

const promptIfScoped = vi.fn();
vi.mock('@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker', () => ({
  usePostSaveResourcePicker: () => ({ promptIfScoped }),
}));

vi.mock('@/features/vault/sub_credentials/components/forms/CredentialEditForm', () => ({
  CredentialEditForm: ({ onSave }: { onSave: (v: Record<string, string>) => void }) => (
    <button type="button" onClick={() => onSave({ api_key: 'k' })}>save</button>
  ),
}));

vi.mock('@/i18n/useTranslatedError', () => ({
  resolveErrorTranslated: (_t: unknown, raw: string | null) => ({ message: `resolved:${raw ?? 'generic'}` }),
}));

const { CredentialSchemaForm } = await import('../CredentialSchemaForm');

const config: SchemaFormConfig = {
  headerIcon: null,
  title: 'Custom',
  subtitle: '',
  nameLabel: 'Name',
  namePlaceholder: '',
  subTypeLabel: '',
  subTypes: [{ id: 'api-key', label: 'API key', description: '', fields: [] }],
  subTypeLayout: 'flex',
  subTypeActiveClass: '',
  serviceTypePrefix: 'custom',
  category: 'custom',
  connectorColor: '#000000',
  healthKey: 'test-schema-form',
  subTypeMetadataKey: 'auth_type',
};

function renderForm(onComplete = vi.fn()) {
  render(
    <CredentialSchemaForm
      config={config}
      onBack={() => {}}
      onComplete={onComplete}
      nameOverride="Acme"
      showHeader={false}
    />,
  );
  return onComplete;
}

describe('CredentialSchemaForm save', () => {
  beforeEach(() => {
    for (const fn of Object.values(store)) fn.mockReset();
    promptIfScoped.mockReset();
    store.createConnectorDefinition.mockResolvedValue({ id: 'conn-1' });
    store.createCredential.mockResolvedValue('cred-1');
    store.fetchCredentials.mockResolvedValue(undefined);
    store.fetchConnectorDefinitions.mockResolvedValue(undefined);
    store.deleteConnectorDefinition.mockResolvedValue(undefined);
    promptIfScoped.mockResolvedValue(undefined);
  });

  it('keeps the connector of a saved credential when the post-save refresh fails', async () => {
    store.fetchCredentials.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    const onComplete = renderForm();
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(store.createCredential).toHaveBeenCalledTimes(1);
    expect(store.deleteConnectorDefinition).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rolls the connector back and shows the backend reason when the credential write is refused', async () => {
    store.createCredential.mockRejectedValue({ error: 'A credential with this name already exists', kind: 'Validation' });
    const onComplete = renderForm();
    fireEvent.click(screen.getByText('save'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('resolved:A credential with this name already exists');
    expect(store.deleteConnectorDefinition).toHaveBeenCalledWith('conn-1');
    expect(onComplete).not.toHaveBeenCalled();
  });
});

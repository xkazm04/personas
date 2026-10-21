import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/stores/vaultStore', () => ({ useVaultStore: { getState: () => ({}) } }));
vi.mock('@/api/overview/healthcheckApi', () => ({ testCredentialDesignHealthcheck: vi.fn() }));

const startConsent = vi.fn();
let oauthValues: Record<string, string> = {};
vi.mock('@/features/vault/shared/hooks/useGoogleOAuth', () => ({
  useGoogleOAuth: () => ({
    isAuthorizing: false,
    completedAt: null,
    message: null,
    getValues: () => oauthValues,
    valuesVersion: 0,
    startConsent,
    reset: vi.fn(),
  }),
}));

// The real form is large; the modal's job under test is what it hands the form.
vi.mock('@/features/vault/sub_catalog/components/forms/CredentialTemplateForm', () => ({
  CredentialTemplateForm: (p: {
    onOAuthConsent: (v: Record<string, string>) => void;
    onCreateCredential: (v: Record<string, string>) => void;
  }) => (
    <div>
      <button type="button" onClick={() => p.onOAuthConsent({ scopes: 'a b' })}>authorize</button>
      <button type="button" onClick={() => p.onCreateCredential({ note: 'x' })}>save</button>
    </div>
  ),
}));

import { CatalogCredentialModal } from '../CatalogCredentialModal';
import type { ConnectorDefinition } from '@/lib/types/types';

const google = {
  name: 'google_workspace_oauth_template',
  label: 'Google',
  fields: [],
  metadata: { oauth_type: 'google' },
} as unknown as ConnectorDefinition;

describe('CatalogCredentialModal Google sign-in', () => {
  beforeEach(() => { startConsent.mockReset(); oauthValues = {}; });

  it('Authorize starts the Google consent flow for this connector', () => {
    render(<CatalogCredentialModal connectorDefinition={google} onSave={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText('authorize'));
    expect(startConsent).toHaveBeenCalledWith('google_workspace_oauth_template', ['a', 'b']);
  });

  it('saving carries the completed session ref to onSave', () => {
    oauthValues = { oauth_session_ref: 'ref-1' };
    const onSave = vi.fn();
    render(<CatalogCredentialModal connectorDefinition={google} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByText('save'));
    expect(onSave).toHaveBeenCalledWith({ note: 'x', oauth_session_ref: 'ref-1' });
  });
});

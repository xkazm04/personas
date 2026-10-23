import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
import cs from '@/i18n/locales/cs.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { ...en, templates: { ...en.templates, gallery: { ...en.templates.gallery, ...cs.templates.gallery } } },
    tx: (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])),
  }),
}));

const silent = vi.fn();
vi.mock('@/lib/silentCatch', async (orig) => ({
  ...(await orig<typeof import('@/lib/silentCatch')>()),
  silentCatch: (ctx: string) => (err: unknown) => silent(ctx, err),
}));

const preview = vi.fn();
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: { getState: () => ({ healthcheckCredentialPreview: preview }) },
}));
vi.mock('@/api/overview/healthcheckApi', () => ({ testCredentialDesignHealthcheck: vi.fn() }));

// The real form is large; the modal's job under test is what it hands the form.
vi.mock('@/features/vault/sub_catalog/components/forms/CredentialTemplateForm', () => ({
  CredentialTemplateForm: (p: {
    credentialName: string;
    onHealthcheck: (v: Record<string, string>) => void;
    healthcheckResult: { message: string } | null;
  }) => (
    <div>
      <span data-testid="name">{p.credentialName}</span>
      <button type="button" onClick={() => p.onHealthcheck({})}>go</button>
      <span data-testid="result">{p.healthcheckResult?.message ?? ''}</span>
    </div>
  ),
}));

import { CatalogCredentialModal } from '../CatalogCredentialModal';
import type { ConnectorDefinition } from '@/lib/types/types';

const connector = { name: 'slack', label: 'Slack', fields: [], healthcheck_config: { x: 1 } } as unknown as ConnectorDefinition;

describe('CatalogCredentialModal healthcheck failure', () => {
  beforeEach(() => { silent.mockReset(); preview.mockReset(); });

  it('reports the error and shows a localized line, with a localized default name', async () => {
    const boom = new Error('socket hang up');
    preview.mockRejectedValue(boom);
    render(<CatalogCredentialModal connectorDefinition={connector} onSave={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('name').textContent).toBe(cs.templates.gallery.cred_default_name.replace('{name}', 'Slack'));
    fireEvent.click(screen.getByText('go'));
    await vi.waitFor(() => expect(screen.getByTestId('result').textContent).not.toBe(''));
    expect(silent).toHaveBeenCalledWith('CatalogCredentialModal:healthcheck', boom);
    expect(screen.getByTestId('result').textContent).not.toBe('Healthcheck failed');
  });
});

/**
 * The rename-failure toast was a hardcoded English sentence (with a ternary that
 * was always true). It now reads `vault.databases.rename_failed`, so the toast
 * follows the UI language.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import en from '@/i18n/locales/en.json';
import { resetInvokeMocks, mockInvokeMap } from '@/test/tauriMock';
import type { CredentialMetadata } from '@/lib/types/types';

const toastSpy = vi.fn();
vi.mock('@/lib/silentCatch', async (orig) => ({
  ...(await orig<typeof import('@/lib/silentCatch')>()),
  toastCatch: (ctx: string, message?: string) => (err: unknown) => toastSpy(ctx, message, err),
}));
vi.mock('@/api/vault/credentials', async (orig) => ({
  ...(await orig<typeof import('@/api/vault/credentials')>()),
  updateCredential: vi.fn(async () => { throw new Error('backend down'); }),
}));

import { SchemaManagerModal } from '../SchemaManagerModal';

const cred = {
  id: 'cred-1', name: 'My Test Database', service_type: 'supabase',
  created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
  last_used_at: null, metadata: null,
} as unknown as CredentialMetadata;

describe('SchemaManagerModal rename failure copy', () => {
  beforeEach(() => {
    resetInvokeMocks();
    mockInvokeMap({ list_db_schema_tables: [], list_db_saved_queries: [] });
    toastSpy.mockClear();
  });

  it('toasts the catalog string, not a literal', async () => {
    render(<SchemaManagerModal credential={cred} connector={undefined} onClose={() => {}} />);
    fireEvent.click(screen.getByTitle(en.vault.databases.rename_credential));
    const input = screen.getByDisplayValue('My Test Database');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls[0]![1]).toBe((en.vault.databases as Record<string, string>).rename_failed);
    expect(toastSpy.mock.calls[0]![1]).toBeTruthy();
  });
});

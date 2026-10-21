/**
 * Hover-revealed icon buttons (opacity-0 until hover) must also appear on
 * keyboard focus, or a Tab lands on an invisible delete/rename control.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '@/i18n/locales/en.json';
import { resetInvokeMocks, mockInvokeMap } from '@/test/tauriMock';
import { useVaultStore } from '@/stores/vaultStore';
import type { CredentialMetadata } from '@/lib/types/types';
import { SchemaManagerModal } from '../SchemaManagerModal';
import { QuerySidebar } from '../tabs/QuerySidebar';

const cred = {
  id: 'cred-1', name: 'My Test Database', service_type: 'supabase',
  created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
  last_used_at: null, metadata: null,
} as unknown as CredentialMetadata;

describe('hover-only controls reveal on focus', () => {
  beforeEach(() => {
    resetInvokeMocks();
    mockInvokeMap({ list_db_schema_tables: [], list_db_saved_queries: [] });
  });

  it('the credential rename pencil', () => {
    render(<SchemaManagerModal credential={cred} connector={undefined} onClose={() => {}} />);
    const btn = screen.getByTitle(en.vault.databases.rename_credential);
    expect(btn.className).toContain('focus-visible:opacity-100');
  });

  it('the saved-query delete button', () => {
    useVaultStore.setState({
      dbSavedQueries: [{ id: 'q1', credential_id: 'cred-1', title: 'My query', is_favorite: false }],
    } as never);
    render(<QuerySidebar credentialId="cred-1" language="sql" selectedId={null} onSelect={() => {}} />);
    const btn = screen.getByRole('button', { name: en.common.delete });
    expect(btn.className).toContain('focus-visible:opacity-100');
  });
});

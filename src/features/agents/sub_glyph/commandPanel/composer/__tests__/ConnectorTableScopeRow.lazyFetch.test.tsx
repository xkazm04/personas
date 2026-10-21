/**
 * The scope row introspects its remote database on first reveal, not on mount.
 * It mounted useTableIntrospection with autoFetch defaulting to true, so opening
 * the picker queried every database connector's remote catalog at once.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const introspectDbTables = vi.fn();
vi.mock('@/api/vault/database/dbSchema', () => ({
  introspectDbTables: (...a: unknown[]) => introspectDbTables(...a),
  introspectDbColumns: vi.fn(),
}));
vi.mock('../ComposerBrandIcon', () => ({ ComposerBrandIcon: () => null }));

import { ConnectorTableScopeRow } from '../ConnectorTableScopeRow';
import type { HealthyConnector } from '@/features/agents/shared/quickConfig/useHealthyConnectors';

const connector = (id: string): HealthyConnector =>
  ({
    name: 'supabase',
    credentialId: id,
    category: 'database',
    meta: { label: 'Supabase', color: '#3ecf8e', iconUrl: null },
  }) as unknown as HealthyConnector;

beforeEach(() => {
  introspectDbTables.mockReset();
  introspectDbTables.mockResolvedValue({ columns: ['table_name', 'table_type'], rows: [], truncated: false });
});

describe('ConnectorTableScopeRow', () => {
  it('does not query the remote database while the scope is "All tables"', async () => {
    render(<ConnectorTableScopeRow connector={connector('cred-lazy-1')} selected={[]} onChange={vi.fn()} />);
    await Promise.resolve();
    expect(introspectDbTables).not.toHaveBeenCalled();
  });

  it('queries once the user opens the table checklist', async () => {
    render(<ConnectorTableScopeRow connector={connector('cred-lazy-2')} selected={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    await waitFor(() => expect(introspectDbTables).toHaveBeenCalledTimes(1));
  });

  it('queries on mount when a saved subset reopens the checklist', async () => {
    render(<ConnectorTableScopeRow connector={connector('cred-lazy-3')} selected={['users']} onChange={vi.fn()} />);
    await waitFor(() => expect(introspectDbTables).toHaveBeenCalledTimes(1));
  });
});

/** Revoke is irreversible from the UI: the first click arms, the second commits. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import { ApiKeyRow } from './ApiKeysSettings';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const apiKey: ExternalApiKey = {
  id: 'k1',
  name: 'Key one',
  key_prefix: 'pk_k1',
  scopes: '[]',
  enabled: true,
  created_at: '2026-09-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
  bound_origin: null,
  label: null,
};

describe('ApiKeyRow revoke', () => {
  it('needs two clicks before onRevoke fires', () => {
    const onRevoke = vi.fn();
    render(<ApiKeyRow apiKey={apiKey} actioning={false} onRevoke={onRevoke} onDelete={vi.fn()} onAudit={vi.fn()} />);
    const btn = screen.getByText('Revoke').closest('button')!;
    fireEvent.click(btn);
    expect(onRevoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm').closest('button')!);
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });
});

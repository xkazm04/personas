/** One verdict per key: the stale nudge applies only to keys that can still authenticate. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import { ApiKeyRow } from './ApiKeysSettings';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
const base: ExternalApiKey = {
  id: 'k1',
  name: 'Old key',
  key_prefix: 'pk_k1',
  scopes: '[]',
  enabled: true,
  created_at: old,
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
  bound_origin: null,
  label: null,
};

function renderRow(key: ExternalApiKey) {
  return render(<ApiKeyRow apiKey={key} actioning={false} onRevoke={vi.fn()} onDelete={vi.fn()} onAudit={vi.fn()} />);
}

describe('ApiKeyRow stale chip', () => {
  it('marks a live, long-unused key as stale', () => {
    renderRow(base);
    expect(screen.queryByText('Stale')).not.toBeNull();
  });

  it('does not mark an expired key as stale', () => {
    renderRow({ ...base, expires_at: new Date(Date.now() - 86_400_000).toISOString() });
    expect(screen.queryByText('Expired')).not.toBeNull();
    expect(screen.queryByText('Stale')).toBeNull();
  });
});

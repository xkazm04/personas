/** Sibling rows on the API Keys page share one type rank for the row name. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import { ConnectedAppsSection } from './ConnectedAppsSection';
import { ApiKeyRow } from './ApiKeysSettings';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const recent = new Date(Date.now() - 86_400_000).toISOString();
const key: ExternalApiKey = {
  id: 'k1',
  name: 'Paired app',
  key_prefix: 'pk_k1',
  scopes: '[]',
  enabled: true,
  created_at: recent,
  last_used_at: recent,
  revoked_at: null,
  expires_at: null,
  bound_origin: 'https://app.example',
  label: null,
};

describe('row name type rank', () => {
  it('connected-app rows and key rows use the same typo class', () => {
    const { unmount } = render(
      <ConnectedAppsSection keys={[key]} actioningIds={new Set()} onDisconnect={vi.fn()} onAudit={vi.fn()} onRetired={vi.fn()} />,
    );
    const appCls = screen.getByText('Paired app').className.split(/\s+/).filter((c) => c.startsWith('typo-'));
    unmount();
    render(<ApiKeyRow apiKey={{ ...key, name: 'Plain key', bound_origin: null }} actioning={false} onRevoke={vi.fn()} onDelete={vi.fn()} onAudit={vi.fn()} />);
    const keyCls = screen.getByText('Plain key').className.split(/\s+/).filter((c) => c.startsWith('typo-'));
    expect(appCls).toEqual(keyCls);
  });
});

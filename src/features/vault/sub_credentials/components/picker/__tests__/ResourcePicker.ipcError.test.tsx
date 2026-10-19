import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ResourceSpec } from '@/lib/types/types';

/**
 * listConnectorResources goes through invokeWithTimeout, which rejects with
 * the AppError object. The picker's `String(e)` fallback painted
 * "[object Object]" in the spec's warning row instead of the provider reason.
 */
vi.mock('@/api/credentials/scopedResources', () => ({
  listConnectorResources: vi.fn(() =>
    Promise.reject({ error: 'GitHub returned 401: Bad credentials', kind: 'auth' }),
  ),
  saveScopedResources: vi.fn(),
}));

import { ResourcePicker } from '../ResourcePicker';

const spec = { id: 'repos', label: 'Repositories', selection: 'multi' } as ResourceSpec;

describe('ResourcePicker fetch failure', () => {
  it('shows the backend reason, not [object Object]', async () => {
    render(
      <ResourcePicker credentialId="cred-1" connectorLabel="GitHub" specs={[spec]} onClose={() => {}} />,
    );
    expect(await screen.findByText(/Bad credentials/)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toContain('[object Object]');
  });
});

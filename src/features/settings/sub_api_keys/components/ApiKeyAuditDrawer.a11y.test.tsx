/**
 * The drawer's icon-only close button needs an accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/api/auth/externalApiKeys', () => ({
  listApiKeyAudit: vi.fn(() => new Promise(() => {})),
}));

import { ApiKeyAuditDrawer } from './ApiKeyAuditDrawer';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('ApiKeyAuditDrawer a11y', () => {
  it('names its close button', async () => {
    render(<ApiKeyAuditDrawer keyId="k-a11y-2" keyName="ci-bot" onClose={vi.fn()} />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeNull();
  });

  it('announces loading, not the dialog title, while the trail loads', async () => {
    render(<ApiKeyAuditDrawer keyId="k-a11y-3" keyName="ci-bot" onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('status').textContent).toBe('Loading...');
  });
});

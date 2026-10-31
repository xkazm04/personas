/**
 * The drawer's icon-only close button needs an accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
});

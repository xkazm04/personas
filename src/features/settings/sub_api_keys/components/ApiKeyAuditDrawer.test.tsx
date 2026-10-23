/**
 * The audit drawer is a modal over the API Keys page, so it must behave like
 * one: a labelled dialog that Escape dismisses (BaseModal's stack, focus trap
 * and Escape arbitration), not a painted full-screen div that ignores the
 * keyboard.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/auth/externalApiKeys', () => ({
  listApiKeyAudit: vi.fn(async () => []),
}));

import { ApiKeyAuditDrawer } from './ApiKeyAuditDrawer';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('ApiKeyAuditDrawer', () => {
  it('is a labelled dialog that Escape closes', async () => {
    const onClose = vi.fn();
    render(<ApiKeyAuditDrawer keyId="k1" keyName="ci-bot" onClose={onClose} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

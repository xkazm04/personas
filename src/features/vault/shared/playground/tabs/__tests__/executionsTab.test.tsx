import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...a: unknown[]) => invoke(...a),
}));

import { ExecutionsTab } from '../ExecutionsTab';

describe('ExecutionsTab', () => {
  beforeEach(() => invoke.mockReset());

  it('says the read failed instead of claiming there is no activity', async () => {
    invoke.mockImplementation((cmd: string) => cmd === 'credential_audit_log'
      ? Promise.reject({ error: 'database is locked', kind: 'Database' })
      : Promise.resolve(null));
    render(<ExecutionsTab credentialId="cred-1" createdAt="2026-01-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy());
    expect(screen.queryByText('No recorded activity yet')).toBeNull();
  });

  it('keeps the honest empty state for a read that returned nothing', async () => {
    invoke.mockResolvedValue([]);
    render(<ExecutionsTab credentialId="cred-1" createdAt="2026-01-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByText('No recorded activity yet')).toBeTruthy());
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useVaultStore } from '@/stores/vaultStore';
import { useAgentStore } from '@/stores/agentStore';
import type { CredentialMetadata } from '@/lib/types/types';
import { ConnectedServicesWidget } from '../ConnectedServicesWidget';

function cred(i: number, ok: boolean | null, message: string | null = null): CredentialMetadata {
  return {
    id: `c-${i}`, name: `Service ${i}`, service_type: 'svc', serviceType: 'svc', metadata: null,
    healthcheck_last_success: ok, healthcheck_last_message: message,
  } as unknown as CredentialMetadata; // fixture: only the fields the widget reads
}

/**
 * Connected services shows every credential's health and never cuts a list silently: failing
 * credentials sort first (a cap can never hide one) and a list longer than the cap offers
 * "Show all", which expands in place.
 */
describe('ConnectedServicesWidget', () => {
  beforeEach(() => {
    useAgentStore.setState({ personas: [], fetchPersonas: vi.fn().mockResolvedValue(undefined) } as never);
  });

  it('lists failing credentials first, with the probe message', () => {
    useVaultStore.setState({
      credentials: [cred(1, true), cred(2, false, 'Token expired'), cred(3, true)],
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<ConnectedServicesWidget config={{}} />);
    const rows = Array.from(document.querySelectorAll('[data-testid="cockpit-connected-services-table"] .row-hover-lift'));
    expect(rows[0]?.textContent).toContain('Service 2');
    expect(screen.getByText('Token expired')).toBeInTheDocument();
  });

  it('caps at the configured limit and expands in place on Show all', () => {
    useVaultStore.setState({
      credentials: Array.from({ length: 12 }, (_, i) => cred(i, true)),
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
    } as never);
    render(<ConnectedServicesWidget config={{ limit: 5 }} />);
    const rows = () => document.querySelectorAll('[data-testid="cockpit-connected-services-table"] .row-hover-lift');
    expect(rows().length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: /12/ }));
    expect(rows().length).toBe(12);
  });
});

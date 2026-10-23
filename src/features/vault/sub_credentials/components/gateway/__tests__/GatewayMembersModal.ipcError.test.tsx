import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CredentialMetadata } from '@/lib/types/types';

/**
 * invokeWithTimeout rejects with the serialized AppError object. The gateway
 * modal stringified it with `e instanceof Error ? e.message : String(e)`, so a
 * failed member load painted "[object Object]" where the reason belonged.
 */
vi.mock('@/api/credentials/mcpGateways', () => ({
  listMcpGatewayMembers: vi.fn(() => Promise.reject({ error: 'Database error: disk I/O error', kind: 'database' })),
  addMcpGatewayMember: vi.fn(),
  removeMcpGatewayMember: vi.fn(),
  setMcpGatewayMemberEnabled: vi.fn(),
}));

import { GatewayMembersModal } from '../GatewayMembersModal';

const gateway = {
  id: 'gw-1',
  name: 'My gateway',
  service_type: 'mcp_gateway',
} as CredentialMetadata;

describe('GatewayMembersModal load failure', () => {
  it('renders a sentence, never "[object Object]"', async () => {
    render(<GatewayMembersModal credential={gateway} onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
    await waitFor(() => expect(document.body.textContent ?? '').not.toContain('Loading'));
    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(body).not.toContain('[object Object]');
      expect(body.length).toBeGreaterThan(0);
    });
    // The retry affordance proves the load-failure branch rendered.
    expect(await screen.findByText(/try again/i)).toBeTruthy();
    expect(document.body.textContent ?? '').not.toContain('[object Object]');
  });
});

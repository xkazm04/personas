import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const resolveMcpRequest = vi.fn();

vi.mock('../useMcpRequestBridge', () => ({
  resolveMcpRequest: (...args: unknown[]) => resolveMcpRequest(...args),
}));

import { McpRequestPanel } from '../McpRequestPanel';
import { useMcpRequestStore, type McpPendingRequest } from '../mcpRequestStore';

function approval(
  requestId: string,
  fleetSessionId: string,
  action = 'write file',
): McpPendingRequest {
  return {
    requestId,
    fleetSessionId,
    kind: 'approval',
    payload: { action, rationale: '', details: null },
    receivedAt: Date.now(),
  };
}

function guidance(
  requestId: string,
  fleetSessionId: string,
): McpPendingRequest {
  return {
    requestId,
    fleetSessionId,
    kind: 'guidance',
    payload: { question: 'which path?', context: null },
    receivedAt: Date.now(),
  };
}

beforeEach(() => {
  resolveMcpRequest.mockReset();
  useMcpRequestStore.getState().clear();
});

describe('McpRequestPanel batch approve', () => {
  it('does not show the batch affordance for a single pending approval', () => {
    useMcpRequestStore.getState().addRequest(approval('req1', 'sess_aaaa1111'));
    render(<McpRequestPanel />);
    expect(screen.queryByTestId('companion-mcp-batch-approve')).toBeNull();
  });

  it('shows the batch affordance when 2+ approvals from the same session are pending', () => {
    const s = useMcpRequestStore.getState();
    s.addRequest(approval('req1', 'sess_aaaa1111'));
    s.addRequest(approval('req2', 'sess_aaaa1111'));
    s.addRequest(approval('req3', 'sess_aaaa1111'));
    render(<McpRequestPanel />);
    expect(
      screen.getByTestId('companion-mcp-batch-approve'),
    ).toBeInTheDocument();
    // Pending label mentions the count + session id. There's one session
    // group div carrying the data-fleet-session-id attribute; assert the
    // label text lives inside that group's text content.
    const group = screen.getByTestId('companion-mcp-session-group');
    expect(group.textContent).toContain('3');
    expect(group.textContent).toContain('sess_aaa');
  });

  it('does not show batch when each approval is from a different session', () => {
    const s = useMcpRequestStore.getState();
    s.addRequest(approval('req1', 'sess_aaaa1111'));
    s.addRequest(approval('req2', 'sess_bbbb2222'));
    render(<McpRequestPanel />);
    expect(screen.queryByTestId('companion-mcp-batch-approve')).toBeNull();
  });

  it('does not show batch for 1 approval + N guidance from the same session', () => {
    const s = useMcpRequestStore.getState();
    s.addRequest(approval('req1', 'sess_aaaa1111'));
    s.addRequest(guidance('req2', 'sess_aaaa1111'));
    s.addRequest(guidance('req3', 'sess_aaaa1111'));
    render(<McpRequestPanel />);
    expect(screen.queryByTestId('companion-mcp-batch-approve')).toBeNull();
  });

  it('shows separate batch buttons for separate sessions that each have 2+ approvals', () => {
    const s = useMcpRequestStore.getState();
    s.addRequest(approval('a1', 'sess_aaaa1111'));
    s.addRequest(approval('a2', 'sess_aaaa1111'));
    s.addRequest(approval('b1', 'sess_bbbb2222'));
    s.addRequest(approval('b2', 'sess_bbbb2222'));
    render(<McpRequestPanel />);
    expect(screen.getAllByTestId('companion-mcp-batch-approve')).toHaveLength(2);
  });

  it('batch approve fires resolveMcpRequest for every approval in that group only', async () => {
    resolveMcpRequest.mockResolvedValue(true);
    const s = useMcpRequestStore.getState();
    s.addRequest(approval('req1', 'sess_aaaa1111'));
    s.addRequest(approval('req2', 'sess_aaaa1111'));
    s.addRequest(guidance('req3', 'sess_aaaa1111')); // guidance NOT batched
    s.addRequest(approval('req4', 'sess_bbbb2222')); // different session NOT batched
    render(<McpRequestPanel />);
    fireEvent.click(screen.getByTestId('companion-mcp-batch-approve'));
    await waitFor(() => {
      expect(resolveMcpRequest).toHaveBeenCalledTimes(2);
    });
    expect(resolveMcpRequest).toHaveBeenCalledWith('req1', {
      approved: true,
      note: '',
    });
    expect(resolveMcpRequest).toHaveBeenCalledWith('req2', {
      approved: true,
      note: '',
    });
    // req3 (guidance) and req4 (different session) NOT batched.
    expect(resolveMcpRequest).not.toHaveBeenCalledWith(
      'req3',
      expect.anything(),
    );
    expect(resolveMcpRequest).not.toHaveBeenCalledWith(
      'req4',
      expect.anything(),
    );
  });

  it('survives one batched request failing without stalling the rest', async () => {
    resolveMcpRequest
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const s = useMcpRequestStore.getState();
    s.addRequest(approval('a', 'sess_aaaa1111'));
    s.addRequest(approval('b', 'sess_aaaa1111'));
    s.addRequest(approval('c', 'sess_aaaa1111'));
    render(<McpRequestPanel />);
    fireEvent.click(screen.getByTestId('companion-mcp-batch-approve'));
    await waitFor(() => {
      expect(resolveMcpRequest).toHaveBeenCalledTimes(3);
    });
  });
});

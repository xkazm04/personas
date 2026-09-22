import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttentionBar } from '../attention/AttentionBar';
import { useCompanionStore } from '../companionStore';
import { useMcpRequestStore } from '../mcp/mcpRequestStore';
import { useSystemStore } from '@/stores/systemStore';
import type { ProactiveMessage } from '@/api/companion';

function nudge(id: string, triggerKind: string): ProactiveMessage {
  return {
    id,
    message: `msg ${id}`,
    triggerKind,
    triggerRef: null,
    status: 'delivered',
    createdAt: '2026-08-05T10:00:00Z',
  } as ProactiveMessage;
}

beforeEach(() => {
  useCompanionStore.setState({
    proactive: [],
    athenaAssignments: [],
    athenaActions: [],
    pendingDecision: null,
  });
  useMcpRequestStore.setState({ pendingRequests: [] });
  useSystemStore.setState({ companionAlertsExpanded: ['blocked'] });
});

describe('AttentionBar', () => {
  it('renders nothing when nothing needs attention', () => {
    const { container } = render(<AttentionBar />);
    expect(container.firstChild).toBeNull();
  });

  it('counts nudges by severity and hides empty kinds', () => {
    useCompanionStore.setState({
      proactive: [
        nudge('a', 'fleet_failed'),
        nudge('b', 'incident_blocker'),
        nudge('c', 'fleet_stale'),
        nudge('d', 'on_this_day'),
        // aggregated onto the digest card — must not be counted
        nudge('e', 'message_attention'),
      ],
    });
    render(<AttentionBar />);
    expect(screen.getByTestId('companion-attention-errors')).toHaveTextContent('2');
    expect(screen.getByTestId('companion-attention-warnings')).toHaveTextContent('1');
    expect(screen.getByTestId('companion-attention-nudges')).toHaveTextContent('1');
    expect(screen.queryByTestId('companion-attention-blocked')).not.toBeInTheDocument();
    expect(screen.queryByTestId('companion-attention-assignments')).not.toBeInTheDocument();
  });

  it('folds mcp requests and a pending decision into one blocked count', () => {
    useMcpRequestStore.setState({
      pendingRequests: [{ id: 'r1' }, { id: 'r2' }] as never,
    });
    useCompanionStore.setState({ pendingDecision: { id: 'd1' } as never });
    render(<AttentionBar />);
    expect(screen.getByTestId('companion-attention-blocked')).toHaveTextContent('3');
  });

  it('toggling a chip writes through to the persisted store both ways', () => {
    useCompanionStore.setState({ proactive: [nudge('a', 'fleet_failed')] });
    render(<AttentionBar />);
    const chip = screen.getByTestId('companion-attention-errors');
    expect(chip).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(chip);
    expect(useSystemStore.getState().companionAlertsExpanded).toContain('errors');
    expect(screen.getByTestId('companion-attention-errors')).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    fireEvent.click(screen.getByTestId('companion-attention-errors'));
    expect(useSystemStore.getState().companionAlertsExpanded).not.toContain('errors');
  });

  it('reflects a restored preference from a previous session', () => {
    useSystemStore.setState({ companionAlertsExpanded: ['nudges'] });
    useCompanionStore.setState({ proactive: [nudge('a', 'on_this_day')] });
    render(<AttentionBar />);
    expect(screen.getByTestId('companion-attention-nudges')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

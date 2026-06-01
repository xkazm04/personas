/**
 * Unit tests for FleetNeedsYouBanner — P4.1 surfacing of the Notification
 * message (what a waiting session needs) on its chip. Pure presentation;
 * useTranslation is real.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import { FleetNeedsYouBanner } from '../FleetNeedsYouBanner';

function waiting(o: Partial<FleetSession>): FleetSession {
  return {
    id: 'w1', state: 'awaiting_input', projectLabel: 'repo-a', name: null,
    stateReason: null, lastActivityMs: BigInt(Date.now()),
    ...o,
  } as unknown as FleetSession;
}

const noop = async () => {};

describe('FleetNeedsYouBanner', () => {
  it('shows the Notification message (what Claude needs) on the chip', () => {
    const session = waiting({ id: 'w1', stateReason: 'Claude needs your permission to use Bash' });
    render(
      <FleetNeedsYouBanner
        waiting={[session]} onJump={() => {}} onReply={noop}
        approvals={[]} onApprove={noop} onReject={noop} onCycleNext={() => {}}
      />,
    );
    expect(screen.getByText(/needs your permission to use Bash/)).toBeInTheDocument();
  });

  it('jumps to the session when the chip is clicked', async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(
      <FleetNeedsYouBanner
        waiting={[waiting({ id: 'w1' })]} onJump={onJump} onReply={noop}
        approvals={[]} onApprove={noop} onReject={noop} onCycleNext={() => {}}
      />,
    );
    await user.click(screen.getByTestId('fleet-needs-you-chip-w1'));
    expect(onJump).toHaveBeenCalledWith('w1');
  });

  it('renders nothing when there is nothing to attend to', () => {
    const { container } = render(
      <FleetNeedsYouBanner
        waiting={[]} onJump={() => {}} onReply={noop}
        approvals={[]} onApprove={noop} onReject={noop} onCycleNext={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

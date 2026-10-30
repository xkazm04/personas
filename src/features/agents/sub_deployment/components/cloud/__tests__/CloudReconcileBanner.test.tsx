import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { CloudReconcileBanner } from '../CloudReconcileBanner';

const undeploy = vi.fn(() => Promise.resolve());
const adopt = vi.fn(() => Promise.resolve());

const orphan = (over: Record<string, unknown> = {}) => ({
  id: 'dep-1',
  personaId: 'persona-from-another-machine',
  slug: 'billing-bot',
  label: null,
  status: 'active',
  ...over,
});

function mount(orphans: unknown[]) {
  useSystemStore.setState({
    cloudOrphanDeployments: orphans as never,
    cloudReconcileDismissed: false,
    cloudUndeployOrphan: undeploy,
    cloudAdoptOrphan: adopt,
  } as never);
  return render(<CloudReconcileBanner />);
}

beforeEach(() => {
  undeploy.mockClear();
  adopt.mockClear();
  useAgentStore.setState({ personas: [{ id: 'local-1', name: 'Local Helper' }] as never });
});
afterEach(() => {
  act(() => {
    useSystemStore.setState({ cloudOrphanDeployments: [], cloudReconcileDismissed: false } as never);
    useAgentStore.setState({ personas: [] as never });
  });
});

describe('CloudReconcileBanner', () => {
  it('names the orphan and waits for consent before undeploying it', async () => {
    mount([orphan()]);
    fireEvent.click(screen.getByTestId('cloud-reconcile-undeploy-dep-1'));
    // One click on a remote shutdown is a request, not the act.
    expect(undeploy).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('billing-bot');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Undeploy');
    expect(confirm).toBeDefined();
    fireEvent.click(confirm!);
    await waitFor(() => expect(undeploy).toHaveBeenCalledWith('dep-1'));
  });

  it('cancelling the confirmation leaves the deployment running', async () => {
    mount([orphan()]);
    fireEvent.click(screen.getByTestId('cloud-reconcile-undeploy-dep-1'));
    const dialog = await screen.findByRole('dialog');
    const cancel = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel');
    fireEvent.click(cancel!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(undeploy).not.toHaveBeenCalled();
  });

  it('names an orphan from another machine by its deployment label', () => {
    mount([orphan({ label: 'Billing Bot' })]);
    const text = screen.getByTestId('cloud-reconcile-item-dep-1').textContent ?? '';
    expect(text).toContain('Billing Bot');
    expect(text).not.toContain('persona-');
  });

  it('says "Unknown persona" for an orphan with no label and no local record', () => {
    mount([orphan()]);
    const text = screen.getByTestId('cloud-reconcile-item-dep-1').textContent ?? '';
    expect(text).toContain('Unknown persona');
    expect(text).not.toContain('persona-');
  });

  it('names a locally known persona by its name', () => {
    mount([orphan({ personaId: 'local-1' })]);
    expect(screen.getByTestId('cloud-reconcile-item-dep-1').textContent).toContain('Local Helper');
  });
});

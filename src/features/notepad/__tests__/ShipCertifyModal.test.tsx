// Certification is one lifecycle write. A second confirm in the same frame
// must not start another one, and the dialog stays up until that write settles
// so a failed ship can be retried instead of looking finished.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ShipMilestoneVM } from '@/lib/milestone/shipModel';
import { ctx, feature, member, milestone } from '@/lib/milestone/__tests__/shipFixtures';

import { ShipCertifyModal } from '../plan/ShipCertifyModal';

const auth = ctx('c-auth', 'auth', 'ok', 2, 0);

function vm(status: ShipMilestoneVM['status']): ShipMilestoneVM {
  return {
    row: milestone(),
    id: 'ms-1',
    name: 'First ship',
    goal: 'Get the dock in front of a user',
    description: 'The brief lives on the note now.',
    status,
    targetLabel: 'target 2026-10-01',
    members: [member(feature('f1', 'login', [auth]))],
    goalMembers: [],
    boundGoals: [],
    footprint: [auth],
    skillCoverage: [],
    criteria: [
      { id: 'objective', label: 'Objective bound', evidence: 'one goal bound', done: 1, total: 1, state: 'go' },
    ],
    progress: 50,
    duality: { rated: 0, unrated: 1, agree: 0, disagree: 0, conflicts: [] },
  };
}

describe('ShipCertifyModal', () => {
  it('starts one ship write and closes only after it settles', async () => {
    let resolveWrite: () => void = () => {};
    const onCertify = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const onClose = vi.fn();
    render(<ShipCertifyModal vm={vm('active')} onCertify={onCertify} onClose={onClose} />);

    const confirm = screen.getByRole('button', { name: 'Certify ship' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onCertify).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { resolveWrite(); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the dialog open when the write fails so it can be tried again', async () => {
    const onCertify = vi.fn()
      .mockRejectedValueOnce(new Error('ship failed'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<ShipCertifyModal vm={vm('active')} onCertify={onCertify} onClose={onClose} />);

    const confirm = screen.getByRole('button', { name: 'Certify ship' });
    fireEvent.click(confirm);
    await waitFor(() => expect(onCertify).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCertify).toHaveBeenCalledTimes(2);
  });
});

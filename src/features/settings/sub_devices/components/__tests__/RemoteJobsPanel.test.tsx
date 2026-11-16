import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { OwnedDevice } from '@/api/network/devices';

function job(id: string, peerId: string, direction: RemoteJob['direction']): RemoteJob {
  return {
    id,
    direction,
    peerId,
    peerDisplayName: peerId === 'peer-a' ? 'Studio PC' : 'Laptop',
    kind: 'instruction',
    instruction: `do ${id}`,
    payloadJson: null,
    receipt: null,
    meshReceipt: null,
    status: 'completed',
    summary: null,
    refusalReason: null,
    createdAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-05T10:00:00Z',
    lastSeq: 0,
  } as unknown as RemoteJob; // test fixture: only the fields the panel reads are meaningful
}

const devices: OwnedDevice[] = [
  { peerId: 'peer-a', deviceGroupId: 'g', displayName: 'Studio PC', addedAt: '', lastSyncedAt: null, isHome: false, pairedAt: null, publicKey: null },
  { peerId: 'peer-b', deviceGroupId: 'g', displayName: 'Laptop', addedAt: '', lastSyncedAt: null, isHome: false, pairedAt: null, publicKey: null },
];

const state = {
  remoteJobs: [job('j1', 'peer-a', 'outbound'), job('j2', 'peer-b', 'inbound'), job('j3', 'peer-a', 'inbound')],
  remoteJobsLoading: false,
  remoteJobsSynced: true,
  fetchRemoteJobs: vi.fn().mockResolvedValue(undefined),
  fetchRemoteJobNotes: vi.fn().mockResolvedValue([]),
  ownedDevices: devices,
  sendRemoteInstruction: vi.fn(),
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() }),
}));

import { RemoteJobsPanel } from '../RemoteJobsPanel';

const shownJobIds = () =>
  screen.queryAllByTestId(/^remote-job-kind-/).map((el) => el.getAttribute('data-testid')!.replace('remote-job-kind-', ''));

describe('RemoteJobsPanel', () => {
  it('shows every PC\'s jobs and the direction filter without a peer', () => {
    render(<RemoteJobsPanel />);
    expect(shownJobIds().sort()).toEqual(['j1', 'j2', 'j3']);
    expect(screen.getByTestId('remote-jobs-direction-filter')).toBeTruthy();
    expect(screen.getByTestId('remote-instruction-device')).toBeTruthy();
  });

  it('narrows to one PC, hides the direction filter and pins the composer target', () => {
    render(<RemoteJobsPanel peerId="peer-a" />);
    expect(shownJobIds().sort()).toEqual(['j1', 'j3']);
    expect(screen.queryByTestId('remote-jobs-direction-filter')).toBeNull();
    expect(screen.queryByTestId('remote-instruction-device')).toBeNull();
    expect(screen.getByText('Remote jobs for this PC')).toBeTruthy();
  });
});

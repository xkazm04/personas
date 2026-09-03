import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrainViewer } from '../BrainViewer';
import { useCompanionStore } from '../companionStore';
import { __resetCycleCacheForTests } from '../BrainCycleReports';
import { __resetHealthCacheForTests } from '../BrainHealthPanel';

const api = vi.hoisted(() => ({ list: vi.fn(), health: vi.fn(), counts: vi.fn() }));

vi.mock('@/api/companion/brain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/companion/brain')>();
  return { ...actual, companionListCycleReports: api.list, companionBrainHealth: api.health };
});

vi.mock('@/api/companion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/companion')>();
  return { ...actual, companionCountBrainItems: api.counts };
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetCycleCacheForTests();
  __resetHealthCacheForTests();
  api.counts.mockResolvedValue({});
  api.list.mockResolvedValue([]);
  api.health.mockResolvedValue({
    healthy: true,
    vectorLane: false,
    firstBlockingCause: null,
    stages: [{ name: 'corpus', status: 'ok', detail: '480 nodes.' }],
    counters: {
      nodes: 480,
      embedded: 0,
      unembedded: 480,
      vectors: null,
      ftsRows: 480,
      episodes: 231,
      facts: 96,
      procedurals: 14,
      doctrineChunks: 139,
      modelGuardExcluded: 0,
      lastCycleAt: null,
    },
  });
  useCompanionStore.setState({ brainView: { open: true, kind: null, id: null } });
});

describe('BrainViewer root lanes', () => {
  it('offers three lanes — memory, sleep cycles and health', () => {
    render(<BrainViewer />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('does not read the sleep-cycle journal until its lane is opened', () => {
    render(<BrainViewer />);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('reads companion_list_cycle_reports when the sleep-cycles lane is opened', async () => {
    const user = userEvent.setup();
    render(<BrainViewer />);
    await user.click(screen.getAllByRole('tab')[1]!);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
  });

  it('reads companion_brain_health when the health lane is opened', async () => {
    const user = userEvent.setup();
    render(<BrainViewer />);
    await user.click(screen.getAllByRole('tab')[2]!);
    await waitFor(() => expect(screen.getByTestId('brain-health-panel')).toBeInTheDocument());
  });
});

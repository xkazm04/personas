/**
 * Approvals › Backlog after decision-center wave 3.
 *
 *  - A PENDING idea row opens the Decision Deck (backlog chip, that idea on
 *    top); a decided idea keeps BacklogDetailModal.
 *  - The swallow bug is gone: `useBacklogQueue`'s verdicts used to end in
 *    `silentCatch`, so a failed write RESOLVED and the detail modal stepped to
 *    the next idea as if the verdict had landed. They now toast and REJECT,
 *    and the modal stays on the card.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import type { BacklogIdea } from '../backlogModel';

// BacklogPanel docks the Dev Tools triage instruments; none is under test.
vi.mock('@/features/plugins/dev-tools/sub_triage/EffortRiskFilter', () => ({ EffortRiskFilter: () => null }));
vi.mock('@/features/plugins/dev-tools/sub_triage/TriageRulesPanel', () => ({ TriageRulesPanel: () => null }));
vi.mock('@/features/plugins/dev-tools/sub_triage/findings/SensorScoreboard', () => ({ SensorScoreboard: () => null }));
vi.mock('@/features/plugins/dev-tools/sub_triage/findings/SweepButton', () => ({ SweepButton: () => null }));
vi.mock('../AthenaVerdictCard', () => ({ AthenaVerdictCard: () => null }));
vi.mock('../BacklogFocusDeck', () => ({ BacklogFocusDeck: () => null }));
// The table is the shared FacetedDecisionTable; here it is one clickable row
// per idea that calls `onRowClick` exactly the way the real table does.
vi.mock('../BacklogTable', () => ({
  BacklogTable: ({
    rows,
    onRowClick,
  }: {
    rows: BacklogIdea[];
    onRowClick: (r: BacklogIdea, o: BacklogIdea[]) => void;
  }) => (
    <div>
      {rows.map((r) => (
        <div key={r.id} className="row-hover-lift" data-testid={`row-${r.id}`} onClick={() => onRowClick(r, rows)}>
          {r.title}
        </div>
      ))}
    </div>
  ),
}));

import { BacklogPanel } from '../BacklogPanel';
import { BacklogDetailModal } from '../BacklogDetailModal';
import { useBacklogQueue, type BacklogQueue } from '../useBacklogQueue';

function idea(over: Partial<BacklogIdea> = {}): BacklogIdea {
  return {
    id: 'idea-1',
    title: 'Cache the roster query',
    description: 'It runs on every render.',
    reasoning: '',
    category: 'performance',
    origin: null,
    scanType: 'code',
    projectId: 'proj-1',
    projectName: 'Personas',
    effort: 3,
    impact: 8,
    risk: 2,
    priority: null,
    status: 'pending',
    evidence: null,
    verifyState: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    ...over,
  };
}

function queue(rows: BacklogIdea[], status: BacklogQueue['status'] = 'pending'): BacklogQueue {
  return {
    rows,
    counts: null,
    loading: false,
    loadingMore: false,
    hasMore: false,
    status,
    setStatus: vi.fn(),
    loadMore: vi.fn(),
    reload: vi.fn(),
    actingId: null,
    accept: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    projectOptions: [],
  };
}

const addToast = vi.fn();

// New `overview.dc_*` copy reaches the lazily loaded section only after the
// Director re-splits the locales, so these tests pin behaviour, not wording.

beforeEach(() => {
  addToast.mockReset();
  useToastStore.setState({ addToast } as never);
});

afterEach(() => {
  act(() => closeDecisionDeck());
});

describe('BacklogPanel — pending rows open the deck, decided rows the modal', () => {
  it('a pending idea row opens the deck on the backlog chip with that idea on top', () => {
    const q = queue([idea({ id: 'idea-7' })]);
    render(<BacklogPanel queue={q} />);
    fireEvent.click(screen.getByTestId('row-idea-7'));
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'chip', chip: 'backlog' });
    expect(req?.focusId).toBe('idea:idea-7');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an accepted idea row keeps the detail modal and opens no deck', () => {
    const q = queue([idea({ id: 'idea-8', status: 'accepted' })], 'accepted');
    render(<BacklogPanel queue={q} />);
    fireEvent.click(screen.getByTestId('row-idea-8'));
    expect(useDecisionDeckStore.getState().request).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('re-reads the backlog when the deck closes', () => {
    const q = queue([idea({ id: 'idea-9' })]);
    render(<BacklogPanel queue={q} />);
    fireEvent.click(screen.getByTestId('row-idea-9'));
    expect(q.reload).not.toHaveBeenCalled();
    act(() => closeDecisionDeck());
    expect(q.reload).toHaveBeenCalledTimes(1);
  });
});

describe('useBacklogQueue — a failed verdict rejects (the swallow bug)', () => {
  const acceptIdea = vi.fn();
  const fetchTriageIdeas = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    acceptIdea.mockReset();
    fetchTriageIdeas.mockClear();
    useSystemStore.setState({ acceptIdea, fetchTriageIdeas, triageItems: [] } as never);
  });

  it('rejects and toasts when the write fails', async () => {
    acceptIdea.mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() => useBacklogQueue());
    await expect(result.current.accept('idea-1')).rejects.toThrow('disk full');
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error', expect.any(Number));
  });

  it('a lost compare-and-swap says "decided elsewhere", re-reads, and still rejects', async () => {
    acceptIdea.mockRejectedValue(
      new Error("Backlog idea idea-1 was already decided as 'rejected' by a concurrent action"),
    );
    const { result } = renderHook(() => useBacklogQueue());
    fetchTriageIdeas.mockClear();
    await expect(result.current.accept('idea-1')).rejects.toThrow(/concurrent action/);
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast.mock.calls[0]![1]).toBe('warning');
    expect(fetchTriageIdeas).toHaveBeenCalled();
  });

  it('resolves when the write lands', async () => {
    acceptIdea.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBacklogQueue());
    await expect(result.current.accept('idea-1')).resolves.toBeUndefined();
    expect(addToast).not.toHaveBeenCalled();
  });
});

describe('BacklogDetailModal — a failed verdict keeps the card', () => {
  function renderModal(onAccept: (id: string) => Promise<void>) {
    const onStep = vi.fn();
    const onClose = vi.fn();
    render(
      <BacklogDetailModal
        idea={idea()}
        categoryLabel={(k) => k}
        busy={false}
        onAccept={onAccept}
        onReject={vi.fn().mockResolvedValue(undefined)}
        onClose={onClose}
        nav={{ index: 0, total: 3, onStep }}
      />,
    );
    return { onStep, onClose };
  }

  it('does not step to the next idea when the accept rejects', async () => {
    const onAccept = vi.fn().mockRejectedValue(new Error('write failed'));
    const { onStep, onClose } = renderModal(onAccept);
    fireEvent.keyDown(window, { key: 'a' });
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalledWith('idea-1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onStep).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('steps on when the accept lands', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const { onStep } = renderModal(onAccept);
    fireEvent.keyDown(window, { key: 'a' });
    await vi.waitFor(() => expect(onStep).toHaveBeenCalledWith(1));
  });
});

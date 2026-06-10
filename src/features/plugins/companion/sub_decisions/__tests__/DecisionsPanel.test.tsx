import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

const companionListDesignDecisions = vi.fn();

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>(
    '@/api/companion',
  );
  return {
    ...actual,
    companionListDesignDecisions: (...args: unknown[]) =>
      companionListDesignDecisions(...args),
  };
});

import DecisionsPanel from '../DecisionsPanel';
import { useSystemStore } from '@/stores/systemStore';

beforeEach(() => {
  companionListDesignDecisions.mockReset();
  useSystemStore.getState().setActiveBuildIntent(null);
});

describe('DecisionsPanel', () => {
  it('shows loading state then empty state when no decisions', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(<DecisionsPanel />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/hasn't logged/i)).toBeInTheDocument();
    });
  });

  it('groups decisions by personaContext', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: 'persona_A',
        label: 'Model tier',
        choice: 'Sonnet',
        rationale: 'r1',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
      {
        id: 'dec_2',
        sessionId: 'default',
        personaContext: 'persona_A',
        label: 'Triggers',
        choice: 'Slack',
        rationale: 'r2',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:31:00Z',
      },
      {
        id: 'dec_3',
        sessionId: 'default',
        personaContext: 'persona_B',
        label: 'Use cases',
        choice: 'Three',
        rationale: 'r3',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:32:00Z',
      },
    ]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Model tier/)).toBeInTheDocument();
    });
    // Two groups, one per persona_context
    const sections = document.querySelectorAll('[data-context-key]');
    expect(sections.length).toBe(2);
    // Context rail lists every group with its decision count (all=3, A=2, B=1)
    const rail = screen.getByRole('navigation');
    expect(within(rail).getByText('3')).toBeInTheDocument();
    expect(within(rail).getByText('2')).toBeInTheDocument();
    expect(within(rail).getByText('1')).toBeInTheDocument();
  });

  it('narrows the reading pane to the selected rail context', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: 'persona_A',
        label: 'Model tier',
        choice: 'Sonnet',
        rationale: 'r1',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
      {
        id: 'dec_2',
        sessionId: 'default',
        personaContext: 'persona_B',
        label: 'Use cases',
        choice: 'Three',
        rationale: 'r2',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:31:00Z',
      },
    ]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Model tier/)).toBeInTheDocument();
    });
    const rail = screen.getByRole('navigation');
    // Selecting a context shows only that thread…
    fireEvent.click(within(rail).getByText('persona_A'));
    expect(document.querySelectorAll('[data-context-key]').length).toBe(1);
    expect(screen.queryByText(/Use cases/)).toBeNull();
    // …and "All contexts" restores the full pane.
    fireEvent.click(within(rail).getByText(/All contexts/i));
    expect(document.querySelectorAll('[data-context-key]').length).toBe(2);
  });

  it('puts unscoped rows under the "Unscoped" group', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: null,
        label: 'Anything',
        choice: 'Something',
        rationale: 'r',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
    ]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      // Appears in both the context rail and the thread heading.
      expect(screen.getAllByText(/Unscoped/i).length).toBeGreaterThan(0);
    });
  });

  it('refetches with filter when input changes', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      expect(companionListDesignDecisions).toHaveBeenCalledWith(null, 200);
    });
    companionListDesignDecisions.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByTestId('companion-decisions-filter'), {
      target: { value: 'persona_A' },
    });
    await waitFor(() => {
      expect(companionListDesignDecisions).toHaveBeenCalledWith(
        'persona_A',
        200,
      );
    });
  });

  it('shows the filtered-empty state when filter yields zero rows', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/hasn't logged/i)).toBeInTheDocument();
    });
    companionListDesignDecisions.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByTestId('companion-decisions-filter'), {
      target: { value: 'no-match' },
    });
    await waitFor(() => {
      expect(screen.getByText(/No decisions match/i)).toBeInTheDocument();
    });
  });

  it('auto-scopes the filter to activeBuildIntent on mount + renders scope banner', async () => {
    useSystemStore.getState().setActiveBuildIntent('Triage Sentry issues hourly');
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      // First call should already be scoped to the active intent.
      expect(companionListDesignDecisions).toHaveBeenCalledWith(
        'Triage Sentry issues hourly',
        200,
      );
    });
    // Banner present, showing the snapshotted intent.
    expect(
      screen.getByTestId('companion-decisions-scope-banner'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Triage Sentry issues hourly/)).toBeInTheDocument();
    // Filter input pre-filled with the intent.
    expect(
      (screen.getByTestId('companion-decisions-filter') as HTMLInputElement)
        .value,
    ).toBe('Triage Sentry issues hourly');
  });

  it('"Show all" clears the filter, hides banner, and clears the slice', async () => {
    useSystemStore.getState().setActiveBuildIntent('A working intent');
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-decisions-scope-banner'),
      ).toBeInTheDocument();
    });
    companionListDesignDecisions.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByTestId('companion-decisions-show-all'));
    await waitFor(() => {
      // Filter cleared → refetch with null
      expect(companionListDesignDecisions).toHaveBeenCalledWith(null, 200);
    });
    expect(
      screen.queryByTestId('companion-decisions-scope-banner'),
    ).toBeNull();
    expect(useSystemStore.getState().activeBuildIntent).toBeNull();
  });

  it('hides the scope banner once the user edits the filter away from the intent', async () => {
    useSystemStore.getState().setActiveBuildIntent('Initial intent');
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(<DecisionsPanel />);
    await waitFor(() => {
      expect(
        screen.getByTestId('companion-decisions-scope-banner'),
      ).toBeInTheDocument();
    });
    companionListDesignDecisions.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByTestId('companion-decisions-filter'), {
      target: { value: 'something else' },
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('companion-decisions-scope-banner'),
      ).toBeNull();
    });
  });
});

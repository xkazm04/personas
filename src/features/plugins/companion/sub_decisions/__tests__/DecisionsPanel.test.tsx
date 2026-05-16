import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

beforeEach(() => {
  companionListDesignDecisions.mockReset();
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
    // Counts on group headers
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
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
      expect(screen.getByText(/Unscoped/i)).toBeInTheDocument();
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
});

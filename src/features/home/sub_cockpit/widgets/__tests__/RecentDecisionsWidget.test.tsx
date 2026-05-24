import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

import { RecentDecisionsWidget } from '../RecentDecisionsWidget';

beforeEach(() => {
  companionListDesignDecisions.mockReset();
});

describe('RecentDecisionsWidget', () => {
  it('renders nothing when the fetch returns an empty list (soft surface)', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([]);
    const { container } = render(
      <RecentDecisionsWidget config={{ persona_context: 'persona_abc' }} />,
    );
    await waitFor(() => {
      expect(companionListDesignDecisions).toHaveBeenCalledWith(
        'persona_abc',
        3,
      );
    });
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders chips when the fetch returns decisions', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([
      {
        id: 'dec_1',
        sessionId: 'default',
        personaContext: 'persona_abc',
        label: 'Model tier',
        choice: 'Sonnet',
        rationale: 'right balance',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:30:00Z',
      },
      {
        id: 'dec_2',
        sessionId: 'default',
        personaContext: 'persona_abc',
        label: 'Triggers',
        choice: 'Slack only',
        rationale: 'scope it down',
        decisionTimestamp: null,
        createdAt: '2026-05-16T13:31:00Z',
      },
    ]);
    render(
      <RecentDecisionsWidget config={{ persona_context: 'persona_abc' }} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Model tier')).toBeInTheDocument();
      expect(screen.getByText('Sonnet')).toBeInTheDocument();
      expect(screen.getByText('Triggers')).toBeInTheDocument();
      expect(screen.getByText('Slack only')).toBeInTheDocument();
    });
  });

  it('respects custom limit', async () => {
    companionListDesignDecisions.mockResolvedValueOnce([]);
    render(
      <RecentDecisionsWidget
        config={{ persona_context: 'persona_abc', limit: 5 }}
      />,
    );
    await waitFor(() => {
      expect(companionListDesignDecisions).toHaveBeenCalledWith(
        'persona_abc',
        5,
      );
    });
  });
});

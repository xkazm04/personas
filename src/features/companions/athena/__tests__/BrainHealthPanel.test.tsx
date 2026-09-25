import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrainHealthPanel, __resetHealthCacheForTests } from '../BrainHealthPanel';
import type { BrainHealth } from '@/api/companion/brain';

const api = vi.hoisted(() => ({ health: vi.fn() }));

vi.mock('@/api/companion/brain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/companion/brain')>();
  return { ...actual, companionBrainHealth: api.health };
});

/** The eight stages `brain/health.rs::run` always pushes, in its own order. */
const STAGE_NAMES = [
  'ml_feature',
  'embedder',
  'corpus',
  'keyword_index',
  'vector_index',
  'embedding_coverage',
  'model_guard',
  'consolidation',
];

function report(over: Partial<BrainHealth> = {}): BrainHealth {
  return {
    healthy: true,
    vectorLane: false,
    firstBlockingCause: null,
    stages: STAGE_NAMES.map((name) => ({
      name,
      status: 'ok' as const,
      detail: `${name} is fine.`,
    })),
    counters: {
      nodes: 480,
      embedded: 12,
      unembedded: 468,
      vectors: null,
      ftsRows: 480,
      episodes: 231,
      facts: 96,
      procedurals: 14,
      doctrineChunks: 139,
      modelGuardExcluded: 0,
      lastCycleAt: '2026-08-26T02:04:00Z',
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetHealthCacheForTests();
  api.health.mockResolvedValue(report());
});

describe('BrainHealthPanel', () => {
  it('renders every stage the report carries, with its backend detail verbatim', async () => {
    render(<BrainHealthPanel />);
    await waitFor(() => expect(screen.getByTestId('brain-health-panel')).toBeInTheDocument());

    const stages = screen.getAllByTestId('health-stage');
    expect(stages.map((el) => el.getAttribute('data-stage'))).toEqual(STAGE_NAMES);
    expect(screen.getByText('consolidation is fine.')).toBeInTheDocument();
  });

  it('renders every counter, and reports a null vector table as absent rather than zero', async () => {
    render(<BrainHealthPanel />);
    await waitFor(() => expect(screen.getByTestId('brain-health-panel')).toBeInTheDocument());

    const panel = screen.getByTestId('brain-health-panel');
    for (const key of [
      'nodes',
      'embedded',
      'unembedded',
      'vectors',
      'ftsRows',
      'episodes',
      'facts',
      'procedurals',
      'doctrineChunks',
      'modelGuardExcluded',
      'lastCycleAt',
    ]) {
      expect(panel.querySelector(`[data-counter="${key}"]`)).not.toBeNull();
    }
    expect(panel.textContent).toContain('480');
    expect(panel.querySelector('[data-counter="vectors"]')?.textContent).not.toContain('0');
  });

  it('shows the first blocking cause with the fix the backend prescribed', async () => {
    api.health.mockResolvedValue(
      report({
        healthy: false,
        firstBlockingCause: {
          code: 'corpus_empty',
          summary: 'The brain holds no memory nodes yet.',
          fix: 'Have a conversation.',
        },
        stages: [{ name: 'corpus', status: 'blocked', detail: 'The brain holds no memory nodes yet.' }],
      }),
    );

    render(<BrainHealthPanel />);
    await waitFor(() => expect(screen.getByText('Have a conversation.')).toBeInTheDocument());
  });

  it('renders an inline error state when the diagnostic rejects', async () => {
    api.health.mockRejectedValue(new Error('brain health task join failed'));
    render(<BrainHealthPanel />);
    await waitFor(() => expect(screen.getByTestId('health-error')).toBeInTheDocument());
  });

  it('paints warm from the module cache on a remount', async () => {
    const first = render(<BrainHealthPanel />);
    await waitFor(() => expect(screen.getByTestId('brain-health-panel')).toBeInTheDocument());
    first.unmount();

    api.health.mockReturnValue(new Promise(() => {}));
    render(<BrainHealthPanel />);
    expect(screen.getByTestId('brain-health-panel')).toBeInTheDocument();
  });
});

// A rejected run list must not read as "nothing has been run", and a failed
// load of the next note must not keep the previous note's rows on screen.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DevNoteRun } from '@/lib/bindings/DevNoteRun';

import { NotePlanRuns } from '../plan/NotePlanRuns';

const listNoteRuns = vi.hoisted(() => vi.fn());
vi.mock('@/api/notepad', () => ({ listNoteRuns }));

function run(id: string, noteId: string): DevNoteRun {
  return {
    id,
    noteId,
    kind: 'note_task',
    status: 'completed',
    dispatchKey: null,
    fleetSessionId: null,
    runDir: null,
    summaryJson: JSON.stringify({ summary: 'did the thing' }),
    startedAt: '2026-09-15T00:00:00Z',
    completedAt: '2026-09-15T00:01:00Z',
    createdAt: '2026-09-15T00:00:00Z',
  };
}

describe('NotePlanRuns load failure', () => {
  it('says the run list failed instead of claiming nothing has been run', async () => {
    listNoteRuns.mockRejectedValueOnce(new Error('db down'));
    listNoteRuns.mockResolvedValueOnce([run('r1', 'n1')]);
    render(<NotePlanRuns noteId="n1" onCompose={() => {}} />);

    const failed = await screen.findByTestId('note-runs-load-error');
    expect(failed).toHaveTextContent('Could not list what has been run against this note.');
    expect(screen.queryByTestId('note-runs-empty')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('note-run-r1')).toBeInTheDocument();
    expect(screen.queryByTestId('note-runs-load-error')).toBeNull();
  });

  it('does not keep the previous note when the next list fails', async () => {
    listNoteRuns.mockImplementation(async (id: string) => {
      if (id === 'n1') return [run('r1', 'n1')];
      throw new Error('db down');
    });
    const { rerender } = render(<NotePlanRuns noteId="n1" onCompose={() => {}} />);
    expect(await screen.findByTestId('note-run-r1')).toBeInTheDocument();

    rerender(<NotePlanRuns noteId="n2" onCompose={() => {}} />);
    expect(await screen.findByTestId('note-runs-load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('note-run-r1')).toBeNull();
  });
});

/** A `/ship-milestone` run whose report proposes one addition. */
function shipRun(id: string, noteId: string): DevNoteRun {
  return {
    ...run(id, noteId),
    kind: 'ship_milestone',
    summaryJson: JSON.stringify({
      itemsUpdated: 1,
      ratingsSet: 0,
      descriptionsSet: 0,
      itemsReported: 1,
      summary: null,
      proposedAdditions: [{ itemKind: 'use_case', name: 'Export', rationale: null }],
      questionsAsked: [],
    }),
  };
}

describe('NotePlanRuns ship summary action', () => {
  it('names the action it takes: it opens the composer, it does not dismiss', async () => {
    listNoteRuns.mockResolvedValueOnce([shipRun('r1', 'n1')]);
    const onCompose = vi.fn();
    render(<NotePlanRuns noteId="n1" onCompose={onCompose} />);

    await screen.findByTestId('ship-run-summary');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compose scope' }));
    expect(onCompose).toHaveBeenCalledTimes(1);
  });

  it('offers no action when the scope cannot be composed', async () => {
    listNoteRuns.mockResolvedValueOnce([shipRun('r1', 'n1')]);
    render(<NotePlanRuns noteId="n1" />);

    await screen.findByTestId('ship-run-summary');
    expect(screen.queryByTestId('ship-run-summary-compose')).toBeNull();
  });
});

/**
 * The Ready peek's dispatch machinery — the Run Desk's, migrated (first into
 * the retired Quick Answer deck's rail, now into the Decision Center hub's
 * `ready` peek, which renders exactly the pair the harness below renders).
 *
 * **This file used to assert the opposite of the truth.** Its claim was that
 * "Single", "Batch" and "Parallel" were "the Run Desk's three real concurrency
 * techniques and not three labels over one behaviour", and three tests pinned
 * the three different `maxParallel` values that went over the wire. They were
 * three labels over one behaviour: `dev_tools_start_batch` opened with
 * `let _ = max_parallel;` and spawned every task at once, so the number those
 * tests pinned reached nothing. A test can only see the call it makes, and
 * every one of them passed for the whole time the control was decorative.
 *
 * The executor honours the width now (as N strands, with optional per-strand
 * pinning), the modes are gone, and what is pinned below is the lane width and
 * the columns — plus the one thing the old tests could not have checked and
 * the new ones still cannot: that the backend does something with them. That
 * lives in `task_executor.rs`'s own tests, over `plan_batch_lanes`.
 *
 * The other two properties pinned below are the ones whose absence would be
 * invisible in a screenshot: the list reads `dev_tools_undispatched_ideas`
 * (accepted ideas with NO task — not "accepted ideas", which would keep showing
 * work that has already gone out), and a dispatch clears the selection and
 * re-reads, so a second press cannot re-send ids whose rows have left.
 *
 * The trash beside the selection count is the tab's other exit, and it is the
 * one act here with no undo: `dev_tools_bulk_delete_ideas` is a hard DELETE.
 * Three things about it are pinned below, all of them invisible in a
 * screenshot: it cannot fire without passing a confirm dialog, cancelling that
 * dialog must reach no backend at all, and a delete that removed fewer rows
 * than it asked for has to say so rather than report a clean success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

import { DeckAcceptedList } from '../DeckAcceptedList';
import { DeckDispatchBar } from '../DeckDispatchBar';
import { useAcceptedDispatch } from '../useAcceptedDispatch';

const undispatchedIdeas = vi.fn<() => Promise<UndispatchedIdea[]>>();
const dispatchIdeas =
  vi.fn<
    (
      ids: string[],
      target: string,
      opts?: { maxParallel?: number; lanes?: string[][] },
    ) => Promise<unknown>
  >();
const bulkDeleteIdeas = vi.fn<(ids: string[]) => Promise<number>>();

vi.mock('@/api/devTools/devTools', () => ({
  undispatchedIdeas: () => undispatchedIdeas(),
  dispatchIdeas: (
    ids: string[],
    target: string,
    opts?: { maxParallel?: number; lanes?: string[][] },
  ) => dispatchIdeas(ids, target, opts),
  bulkDeleteIdeas: (ids: string[]) => bulkDeleteIdeas(ids),
}));

afterEach(cleanup);

function idea(over: Partial<UndispatchedIdea> = {}): UndispatchedIdea {
  return {
    id: 'i1',
    title: 'Cache the roster',
    projectId: 'p1',
    projectName: 'personas',
    category: null,
    origin: null,
    priority: null,
    impact: null,
    effort: null,
    acceptedAt: '2026-08-20T00:00:00.000Z',
    ageHours: 12,
    ...over,
  };
}

/** The bar over the list, wired to one controller — the Ready peek's body. */
function ReadyHarness() {
  const ctl = useAcceptedDispatch({
    resolveErrorMessage: (err) => (err instanceof Error ? err.message : String(err)),
  });
  return (
    <>
      <DeckDispatchBar ctl={ctl} />
      <DeckAcceptedList ctl={ctl} />
    </>
  );
}

function renderReady() {
  return render(<ReadyHarness />);
}

/** Wait for the accepted rows to land. The `user` is unused; it keeps call sites uniform. */
async function rowsLanded(_user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('checkbox', { name: 'Select Cache the roster' });
}

beforeEach(() => {
  undispatchedIdeas.mockReset();
  dispatchIdeas.mockReset();
  bulkDeleteIdeas.mockReset();
  undispatchedIdeas.mockResolvedValue([idea()]);
  dispatchIdeas.mockResolvedValue({ target: 'runner', dispatched: [{}], skipped: [], started: true });
  bulkDeleteIdeas.mockResolvedValue(1);
});

describe('the accepted list', () => {
  it('reads the UNDISPATCHED list, not the accepted one', async () => {
    renderReady();
    // The distinction is the whole point: `dev_tools_undispatched_ideas` is
    // accepted-with-no-task. Sourcing the list from accepted ideas would keep
    // listing work that has already gone to a runner.
    await waitFor(() => expect(undispatchedIdeas).toHaveBeenCalled());
  });
});

describe('the dispatch modal and its lanes', () => {
  const openModal = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Choose lanes and dispatch' }));
    return screen.findByRole('heading', { name: 'Send to the runner' });
  };

  it('shows the work itself, not a count', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);

    // The reviewer is one press from spending money and wall-clock. The last
    // surface before that has to name what is being sent.
    expect(screen.getAllByText('Cache the roster').length).toBeGreaterThan(0);
  });

  it('sends the lane WIDTH, which the executor now honours', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    // `maxParallelTasks` seeds at 2 in `devToolsTaskSlice` — the SAME store
    // slot the Run Desk's own stepper binds. What changed is that the number
    // reaches something: `dev_tools_start_batch` opened with
    // `let _ = max_parallel;` until 2026-10-05, so the three modes this bar
    // used to show were three names for one behaviour.
    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(['i1'], 'runner', {
        maxParallel: 2,
        lanes: [[], []],
      }),
    );
  });

  it('leaves an unassigned idea out of every column, for the shared pool', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);
    expect(screen.getAllByText('Nothing pinned here')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    // Unassigned is legal and common. The columns go out empty and the
    // executor drops the task into one pool every strand pulls from, so it
    // runs on whichever lane frees up first.
    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(
        ['i1'],
        'runner',
        expect.objectContaining({ lanes: [[], []] }),
      ),
    );
  });

  it('pins an idea to the lane its select names', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);

    // A select, not only a drag: a drag is unreachable by keyboard and this
    // is the last gate before the work costs something.
    await user.click(screen.getByRole('button', { name: 'Lane for Cache the roster' }));
    await user.click(await screen.findByRole('button', { name: 'Lane 2' }));
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(
        ['i1'],
        'runner',
        expect.objectContaining({ lanes: [[], ['i1']] }),
      ),
    );
  });

  it('pins an idea dropped onto a lane column', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);

    fireEvent.drop(screen.getByRole('region', { name: 'Lane 1' }), {
      dataTransfer: { getData: () => 'i1' },
    });
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(
        ['i1'],
        'runner',
        expect.objectContaining({ lanes: [['i1'], []] }),
      ),
    );
  });

  it('drops a pin the reviewer narrows the lane count past, rather than wrapping it', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);
    fireEvent.drop(screen.getByRole('region', { name: 'Lane 2' }), {
      dataTransfer: { getData: () => 'i1' },
    });
    // Down to one lane. The executor would wrap a column index it cannot
    // honour (`column % width`), which is the right answer for work it must
    // not lose and the wrong one for a pin the reviewer can still see.
    await user.click(screen.getByRole('button', { name: 'Decrease' }));
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(
        ['i1'],
        'runner',
        expect.objectContaining({ maxParallel: 1, lanes: [[]] }),
      ),
    );
  });

  it('cannot open the modal with nothing selected', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);
    expect(screen.getByRole('button', { name: 'Choose lanes and dispatch' })).toBeDisabled();
  });

  it('cancels without reaching the backend', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(dispatchIdeas).not.toHaveBeenCalled();
  });

  it('clears the selection and re-reads, so a second press cannot re-send', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    await waitFor(() => expect(dispatchIdeas).toHaveBeenCalledTimes(1));
    // Two reads: the mount, and the one the dispatch triggers.
    await waitFor(() => expect(undispatchedIdeas).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose lanes and dispatch' })).toBeDisabled(),
    );
  });

  it('reports what was skipped beside what went, never folded into one number', async () => {
    dispatchIdeas.mockResolvedValue({
      target: 'runner',
      dispatched: [{}],
      skipped: [{ ideaId: 'i2', reason: 'is rejected' }],
      started: true,
    });
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await openModal(user);
    await user.click(screen.getByRole('button', { name: 'Dispatch 1' }));

    // A dispatch that half worked must not read as one that worked.
    expect(await screen.findByText(/1 skipped/)).toBeTruthy();
  });
});

describe('deleting accepted work', () => {
  const trash = () => screen.getByRole('button', { name: 'Delete selected' });

  it('cannot delete nothing', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);
    // The pile is only drainable in the direction of yes if this is reachable
    // with an empty selection — and a destructive control that fires on nothing
    // is worse than one that is simply not there.
    expect(trash()).toBeDisabled();
  });

  it('asks before deleting, and reaches no backend until confirmed', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(trash());

    // The dialog is up and NOTHING has happened yet. This is the assertion that
    // matters: `dev_tools_bulk_delete_ideas` is a hard DELETE with no undo
    // anywhere in the app, so a mis-click must be recoverable by cancelling.
    expect(await screen.findByText('Delete 1 from the backlog?')).toBeTruthy();
    expect(bulkDeleteIdeas).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bulkDeleteIdeas).not.toHaveBeenCalled();
  });

  it('deletes the ticked ids, clears the selection and re-reads', async () => {
    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(trash());
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(bulkDeleteIdeas).toHaveBeenCalledWith(['i1']));
    // Two reads: the mount, and the one the delete triggers. A list that did
    // not re-read would keep showing rows that are gone from the database.
    await waitFor(() => expect(undispatchedIdeas).toHaveBeenCalledTimes(2));
    // Selection cleared, so a second press cannot re-send ids whose rows left.
    await waitFor(() => expect(trash()).toBeDisabled());
  });

  it('says how many were already gone rather than reporting a clean success', async () => {
    // The list is cross-project and this app runs several sessions against one
    // database, so the backend genuinely deletes fewer rows than it was asked
    // for. Folding that into "Removed 2" is the same lie as folding a skipped
    // dispatch into a dispatched one.
    undispatchedIdeas.mockResolvedValue([idea(), idea({ id: 'i2', title: 'Second idea' })]);
    bulkDeleteIdeas.mockResolvedValue(1);

    const user = userEvent.setup();
    renderReady();
    await rowsLanded(user);
    await screen.findByRole('checkbox', { name: 'Select Second idea' });

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(trash());
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/Removed 1 from the backlog/)).toBeTruthy();
    expect(await screen.findByText(/1 were already gone/)).toBeTruthy();
  });
});

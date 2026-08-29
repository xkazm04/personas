/**
 * The rail's Accepted tab — the Run Desk dispatch machinery, migrated.
 *
 * What is worth pinning here is NOT that the tab renders. It is the one claim
 * the migration actually makes: that "Single", "Batch" and "Parallel" are the
 * Run Desk's three real concurrency techniques and not three labels over one
 * behaviour. Each maps to a different `maxParallel` on the same
 * `dev_tools_dispatch_ideas` call, and `batch` maps to **omitting** it, because
 * the backend's own `max_parallel.unwrap_or(2)` is what "batch" has always
 * meant — sending an explicit 2 would look identical today and silently stop
 * tracking that default the moment it changes.
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
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';

import { DeckQueueRail } from '../deck/DeckQueueRail';
import { makeItem } from './triageFixtures';

const undispatchedIdeas = vi.fn<() => Promise<UndispatchedIdea[]>>();
const dispatchIdeas =
  vi.fn<(ids: string[], target: string, opts?: { maxParallel?: number }) => Promise<unknown>>();
const bulkDeleteIdeas = vi.fn<(ids: string[]) => Promise<number>>();

vi.mock('@/api/devTools/devTools', () => ({
  undispatchedIdeas: () => undispatchedIdeas(),
  dispatchIdeas: (ids: string[], target: string, opts?: { maxParallel?: number }) =>
    dispatchIdeas(ids, target, opts),
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

/** The rail, with one card in the decide queue so it renders at all. */
function renderRail() {
  return render(
    <DeckQueueRail
      items={[makeItem('idea', { title: 'Something to decide' })]}
      cursor={0}
      skips={new Map()}
      onJump={() => {}}
    />,
  );
}

/** Open the Accepted tab and wait for its rows to land. */
async function openAccepted(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Accepted' }));
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

describe('rail tabs', () => {
  it('reads the UNDISPATCHED list, not the accepted one', async () => {
    renderRail();
    // The distinction is the whole point: `dev_tools_undispatched_ideas` is
    // accepted-with-no-task. Sourcing the tab from accepted ideas would keep
    // listing work that has already gone to a runner.
    await waitFor(() => expect(undispatchedIdeas).toHaveBeenCalled());
  });

  it('carries each tab count in its own label', async () => {
    renderRail();
    expect(screen.getByRole('tab', { name: 'To decide' })).toHaveTextContent('1');
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Accepted' })).toHaveTextContent('1'),
    );
  });

  it('declares the region each tab controls', async () => {
    // `SegmentedTabs` emits `aria-controls` unconditionally, so a strip with no
    // declared panel points every tab at an id that does not exist. This is the
    // assertion that keeps the promise true.
    renderRail();
    const panel = await screen.findByRole('tabpanel');
    expect(screen.getByRole('tab', { name: 'To decide' })).toHaveAttribute(
      'aria-controls',
      panel.id,
    );
    expect(panel.id).toBeTruthy();
  });
});

describe('dispatch techniques', () => {
  it('Single sends one at a time', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(screen.getByRole('radio', { name: 'Single' }));
    await user.click(screen.getByRole('button', { name: /Dispatch/ }));

    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(['i1'], 'runner', { maxParallel: 1 }),
    );
  });

  it('Batch OMITS the width so the backend default of 2 stays the definition', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);

    // `batch` is the default mode — no radio click needed, which is itself part
    // of the contract: the safe middle setting is what you get for free.
    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(screen.getByRole('button', { name: /Dispatch/ }));

    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(['i1'], 'runner', { maxParallel: undefined }),
    );
  });

  it('Parallel sends the stepper value, which is the store setting the Run Desk writes', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(screen.getByRole('radio', { name: 'Parallel' }));
    await user.click(screen.getByRole('button', { name: /Dispatch/ }));

    // `maxParallelTasks` seeds at 2 in `devToolsTaskSlice`. The number matters
    // less than where it came from: the SAME store slot the Run Desk's own
    // stepper binds, so the two surfaces cannot disagree about "parallel".
    await waitFor(() =>
      expect(dispatchIdeas).toHaveBeenCalledWith(['i1'], 'runner', { maxParallel: 2 }),
    );
  });

  it('cannot dispatch nothing', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);
    expect(screen.getByRole('button', { name: /Dispatch/ })).toBeDisabled();
  });

  it('clears the selection and re-reads, so a second press cannot re-send', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(screen.getByRole('button', { name: /Dispatch/ }));

    await waitFor(() => expect(dispatchIdeas).toHaveBeenCalledTimes(1));
    // Two reads: the mount, and the one the dispatch triggers.
    await waitFor(() => expect(undispatchedIdeas).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Dispatch/ })).toBeDisabled(),
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
    renderRail();
    await openAccepted(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Cache the roster' }));
    await user.click(screen.getByRole('button', { name: /Dispatch/ }));

    // A dispatch that half worked must not read as one that worked.
    expect(await screen.findByText(/1 skipped/)).toBeTruthy();
  });
});

describe('deleting accepted work', () => {
  const trash = () => screen.getByRole('button', { name: 'Delete selected' });

  it('cannot delete nothing', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);
    // The pile is only drainable in the direction of yes if this is reachable
    // with an empty selection — and a destructive control that fires on nothing
    // is worse than one that is simply not there.
    expect(trash()).toBeDisabled();
  });

  it('asks before deleting, and reaches no backend until confirmed', async () => {
    const user = userEvent.setup();
    renderRail();
    await openAccepted(user);

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
    renderRail();
    await openAccepted(user);

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
    renderRail();
    await openAccepted(user);
    await screen.findByRole('checkbox', { name: 'Select Second idea' });

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(trash());
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/Removed 1 from the backlog/)).toBeTruthy();
    expect(await screen.findByText(/1 were already gone/)).toBeTruthy();
  });
});

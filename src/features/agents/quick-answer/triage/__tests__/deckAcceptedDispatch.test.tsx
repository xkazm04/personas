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

vi.mock('@/api/devTools/devTools', () => ({
  undispatchedIdeas: () => undispatchedIdeas(),
  dispatchIdeas: (ids: string[], target: string, opts?: { maxParallel?: number }) =>
    dispatchIdeas(ids, target, opts),
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
  undispatchedIdeas.mockResolvedValue([idea()]);
  dispatchIdeas.mockResolvedValue({ target: 'runner', dispatched: [{}], skipped: [], started: true });
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

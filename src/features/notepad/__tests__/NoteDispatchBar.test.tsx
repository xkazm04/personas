// The dispatch bar's REACTION, which is the part a screenshot cannot check.
//
// Every one of these asserts something the UX pass of 2026-09-05 found missing
// in the real app: the buttons fired their action and then looked exactly as
// they had before it, so the only evidence a click had landed was whatever
// happened somewhere else on screen.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';

import { NoteDispatchBar } from '../parts/NoteDispatchBar';

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

// The picker fetches projects over IPC and is not what these tests are about.
vi.mock('@/features/plugins/dev-tools/components/DevToolsProjectDropdown', () => ({
  DevToolsProjectDropdown: ({ showPath }: { showPath?: boolean }) => (
    <div data-testid="project-dropdown" data-show-path={String(showPath)} />
  ),
}));

// The picker lists the project's milestones the moment it is opened. These
// tests never open it — what they assert is that the CONTROL is present in the
// draft state and gone once the note is a brief.
vi.mock('@/api/devTools/milestones', () => ({
  listMilestones: vi.fn().mockResolvedValue([]),
}));

const note = (over: Partial<DevNote> = {}): DevNote =>
  ({
    id: 'n1',
    projectId: 'p1',
    milestoneId: null,
    title: 'A note',
    bodyMd: 'body',
    status: 'draft',
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: '2026-09-05T00:00:00Z',
    ...over,
  }) as DevNote;

const project = { id: 'p1', name: 'personas', root_path: '/repo' } as never;

function bar(over: Partial<Parameters<typeof NoteDispatchBar>[0]> = {}) {
  const actions = {
    askAthena: vi.fn().mockResolvedValue({ ok: true }),
    publishFleet: vi.fn().mockResolvedValue({ ok: true }),
    toGoals: vi.fn().mockResolvedValue({ ok: true }),
    promote: vi.fn().mockResolvedValue({ ok: true }),
    link: vi.fn().mockResolvedValue({ ok: true }),
    unlink: vi.fn().mockResolvedValue({ ok: true }),
  };
  const props = {
    note: note(),
    project,
    onSelectProject: vi.fn(),
    actions,
    suggestionCount: 0,
    ...over,
  } as Parameters<typeof NoteDispatchBar>[0];
  const view = render(<NoteDispatchBar {...props} />);
  return { view, actions, props };
}

describe('NoteDispatchBar — the reaction to a press', () => {
  beforeEach(() => {
    addToast.mockClear();
  });

  it('holds the Ask button busy after the click, because the answer has not arrived yet', async () => {
    const { actions } = bar();
    const ask = screen.getByTestId('notepad-ask-athena');

    fireEvent.click(ask);

    await waitFor(() => expect(actions.askAthena).toHaveBeenCalledTimes(1));
    // The click's own promise settles immediately — the prompt is handed over,
    // not awaited — so a button that only tracked it would already be idle.
    await waitFor(() => expect(ask).toBeDisabled());
    expect(ask).toHaveAttribute('aria-busy', 'true');
  });

  it('says so where the eye is: a toast, not just a prompt in a panel that may be shut', async () => {
    bar();
    fireEvent.click(screen.getByTestId('notepad-ask-athena'));
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0]?.[1]).toBe('success');
  });

  it('releases the busy state when a suggestion actually lands', async () => {
    const { view, props } = bar();
    const ask = screen.getByTestId('notepad-ask-athena');
    fireEvent.click(ask);
    await waitFor(() => expect(ask).toBeDisabled());

    view.rerender(<NoteDispatchBar {...props} suggestionCount={1} />);

    await waitFor(() => expect(screen.getByTestId('notepad-ask-athena')).not.toBeDisabled());
  });

  it('does not carry one note’s wait onto another note', async () => {
    const { view, props } = bar();
    fireEvent.click(screen.getByTestId('notepad-ask-athena'));
    await waitFor(() => expect(screen.getByTestId('notepad-ask-athena')).toBeDisabled());

    view.rerender(<NoteDispatchBar {...props} note={note({ id: 'n2' })} />);

    await waitFor(() => expect(screen.getByTestId('notepad-ask-athena')).not.toBeDisabled());
  });

  it('hides the root path in the picker — 16rem cannot hold a path and a name', () => {
    bar();
    expect(screen.getByTestId('project-dropdown')).toHaveAttribute('data-show-path', 'false');
  });

  it('refuses every dispatch on a note that has already left, and says which reason', async () => {
    const { actions } = bar({ note: note({ status: 'published' }) });
    expect(screen.getByTestId('notepad-publish-fleet')).toBeDisabled();
    expect(screen.getByTestId('notepad-to-goals')).toBeDisabled();
    expect(screen.getByTestId('notepad-ask-athena')).toBeDisabled();
    expect(actions.publishFleet).not.toHaveBeenCalled();
  });
});

/**
 * WHICH VERBS EXIST IN WHICH STATE — the part of this bar that is a decision
 * rather than a style.
 *
 * A note is on one of two rails and they are not stages of each other: a draft
 * can be run, decomposed, or PROMOTED into a milestone's brief; a brief is
 * worked, cut and shipped; a shipped note is a record. Offering a rail's verbs
 * in the other rail's state is not a cosmetic slip — "Execute" means two
 * different dispatches on the two rails, and "Unlink" after a cut would orphan
 * the record of what was cut.
 *
 * These are presence assertions on purpose. The plan verbs need a milestone to
 * act on and get it from `NotePlanContext`; rendered outside a provider (as
 * here) that context is null, which is the honest shape for "the bar without a
 * loaded plan" and is exactly when they must still be visible-but-inert rather
 * than absent.
 */
describe('NoteDispatchBar — the verbs each state offers', () => {
  const planNote = (status: DevNote['status']) =>
    note({ status, milestoneId: 'ms-1' });

  it('draft: Execute, Turn into goals, and the milestone picker', () => {
    bar();
    expect(screen.getByTestId('notepad-publish-fleet')).toBeEnabled();
    expect(screen.getByTestId('notepad-to-goals')).toBeEnabled();
    expect(screen.getByTestId('notepad-milestone-picker')).toBeEnabled();
    // The plan rail's verbs belong to a note that HAS a plan.
    expect(screen.queryByTestId('notepad-certify-cut')).toBeNull();
    expect(screen.queryByTestId('notepad-ship')).toBeNull();
    expect(screen.queryByTestId('notepad-unlink')).toBeNull();
  });

  it('draft with no project: the picker is blocked, not hidden', () => {
    bar({ note: note({ projectId: null }) });
    expect(screen.getByTestId('notepad-milestone-picker')).toBeDisabled();
  });

  it('scoped: Execute + Decompose + Certify cut + Unlink, and no brainstorm verbs', () => {
    bar({ note: planNote('scoped') });
    expect(screen.getByTestId('notepad-execute-milestone')).toBeInTheDocument();
    expect(screen.getByTestId('notepad-decompose')).toBeInTheDocument();
    expect(screen.getByTestId('notepad-certify-cut')).toBeInTheDocument();
    expect(screen.getByTestId('notepad-unlink')).toBeInTheDocument();
    // Publishing a brief to Fleet as a /note-task would run the note twice.
    expect(screen.queryByTestId('notepad-publish-fleet')).toBeNull();
    expect(screen.queryByTestId('notepad-to-goals')).toBeNull();
    expect(screen.queryByTestId('notepad-milestone-picker')).toBeNull();
    // Cutting has not happened yet, so there is nothing to ship.
    expect(screen.queryByTestId('notepad-ship')).toBeNull();
  });

  it('cut: Ship replaces Certify, and Unlink is gone', () => {
    bar({ note: planNote('cut') });
    expect(screen.getByTestId('notepad-ship')).toBeInTheDocument();
    expect(screen.queryByTestId('notepad-certify-cut')).toBeNull();
    // After a cut the note IS the record of what was cut; unlinking would
    // orphan that record from the thing it describes.
    expect(screen.queryByTestId('notepad-unlink')).toBeNull();
  });

  it('cut: Ship is refused while the plan has not loaded a verdict', () => {
    bar({ note: planNote('cut') });
    // No provider here means no milestone and therefore no verdict — and the
    // gate's default is SHUT. A Ship button that is live before anything has
    // been read is a button that can ship on no evidence at all.
    expect(screen.getByTestId('notepad-ship')).toBeDisabled();
  });

  it('shipped: nothing but Ask Athena', () => {
    bar({ note: planNote('shipped') });
    expect(screen.getByTestId('notepad-ask-athena')).toBeEnabled();
    for (const id of [
      'notepad-publish-fleet', 'notepad-to-goals', 'notepad-milestone-picker',
      'notepad-execute-milestone', 'notepad-decompose', 'notepad-certify-cut',
      'notepad-ship', 'notepad-unlink',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('shipped: Athena is still reachable — "why did this go this way" is a fair question about a record', async () => {
    const { actions } = bar({ note: planNote('shipped') });
    fireEvent.click(screen.getByTestId('notepad-ask-athena'));
    await waitFor(() => expect(actions.askAthena).toHaveBeenCalledTimes(1));
  });
});

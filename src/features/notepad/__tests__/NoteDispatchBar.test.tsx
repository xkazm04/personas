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

const note = (over: Partial<DevNote> = {}): DevNote =>
  ({
    id: 'n1',
    projectId: 'p1',
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

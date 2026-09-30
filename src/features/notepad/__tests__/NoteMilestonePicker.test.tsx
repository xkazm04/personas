// The milestone menu has two different empty answers, and they must not collapse.
//
// A rejected list used to land in the same `rows = []` slot as a project that
// genuinely has nothing free, so the menu said both "could not list" and "every
// milestone already has a brief", then refused to ask again. A list for the
// previous project also stayed on screen after the note's project changed.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevMilestone } from '@/lib/bindings/DevMilestone';

import { NoteMilestonePicker } from '../parts/NoteMilestonePicker';

const { listMilestones, briefs } = vi.hoisted(() => ({
  listMilestones: vi.fn(),
  briefs: {
    stale: false,
    summaries: {} as Record<string, { milestoneId: string }>,
  },
}));

vi.mock('@/api/devTools/milestones', () => ({ listMilestones }));

vi.mock('../useNotepad', () => ({
  useNotepadPlanSummaries: () => briefs.summaries,
  useNotepadStatus: () => ({
    loading: false,
    loaded: true,
    planSummariesStale: briefs.stale,
    loadError: null,
  }),
}));

const milestone = (projectId: string): DevMilestone => ({
  id: `m-${projectId}`,
  projectId,
  name: `Mile ${projectId}`,
  goal: null,
  description: null,
  status: 'active',
  orderIndex: 0,
  targetDate: null,
  cutAt: null,
  shippedAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

function picker(projectId: string | null) {
  return (
    <NoteMilestonePicker
      projectId={projectId}
      disabled={false}
      onPick={vi.fn()}
      onCreate={vi.fn()}
    />
  );
}

describe('NoteMilestonePicker', () => {
  beforeEach(() => {
    listMilestones.mockReset();
    briefs.stale = false;
    briefs.summaries = {};
  });

  it('says the list failed instead of claiming every milestone is taken, and asks again', async () => {
    listMilestones.mockRejectedValue(new Error('milestones down'));
    render(picker('p1'));
    const trigger = screen.getByTestId('notepad-milestone-picker');

    fireEvent.click(trigger);

    expect(await screen.findByText(/Could not list this project's milestones/)).toBeInTheDocument();
    expect(screen.queryByText(/Every open milestone already has a brief/)).toBeNull();
    expect(listMilestones).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    expect(listMilestones).toHaveBeenCalledTimes(1);

    listMilestones.mockResolvedValueOnce([milestone('p1')]);
    fireEvent.click(trigger);
    expect(await screen.findByText('Mile p1')).toBeInTheDocument();
    expect(listMilestones).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Could not list this project's milestones/)).toBeNull();
  });

  it('hides milestones when the brief index is stale instead of offering them as free', async () => {
    briefs.stale = true;
    listMilestones.mockResolvedValue([milestone('p1')]);
    render(picker('p1'));
    fireEvent.click(screen.getByTestId('notepad-milestone-picker'));

    expect(await screen.findByText(/Which milestones already have a brief is out of date/)).toBeInTheDocument();
    expect(screen.queryByText('Mile p1')).toBeNull();
    expect(screen.queryByText(/Every open milestone already has a brief/)).toBeNull();
    expect(screen.getByTestId('notepad-milestone-new')).toBeInTheDocument();
  });

  it('says none are free when the list really is empty', async () => {
    listMilestones.mockResolvedValue([]);
    render(picker('p1'));
    fireEvent.click(screen.getByTestId('notepad-milestone-picker'));
    expect(await screen.findByText(/Every open milestone already has a brief/)).toBeInTheDocument();
    expect(screen.queryByText(/Could not list this project's milestones/)).toBeNull();
  });

  it('lists the project the note has now, not the one it had when the menu last opened', async () => {
    listMilestones.mockImplementation(async (projectId: string) => [milestone(projectId)]);
    const view = render(picker('p1'));
    const trigger = screen.getByTestId('notepad-milestone-picker');

    fireEvent.click(trigger);
    expect(await screen.findByText('Mile p1')).toBeInTheDocument();
    fireEvent.click(trigger);

    view.rerender(picker('p2'));
    fireEvent.click(trigger);
    expect(await screen.findByText('Mile p2')).toBeInTheDocument();
    expect(screen.queryByText('Mile p1')).toBeNull();
    expect(listMilestones).toHaveBeenCalledWith('p2');
  });

  it('drops a milestone list that arrives after the project changed', async () => {
    let releaseP1: (rows: DevMilestone[]) => void = () => {};
    listMilestones.mockImplementation((projectId: string) => {
      if (projectId === 'p1') {
        return new Promise<DevMilestone[]>((resolve) => {
          releaseP1 = resolve;
        });
      }
      return Promise.resolve([milestone(projectId)]);
    });

    const view = render(picker('p1'));
    const trigger = screen.getByTestId('notepad-milestone-picker');
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    view.rerender(picker('p2'));
    fireEvent.click(trigger);
    expect(await screen.findByText('Mile p2')).toBeInTheDocument();

    releaseP1([milestone('p1')]);
    await waitFor(() => expect(listMilestones).toHaveBeenCalledWith('p2'));
    expect(screen.queryByText('Mile p1')).toBeNull();
    expect(screen.getByText('Mile p2')).toBeInTheDocument();
  });
});

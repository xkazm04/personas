// The drawer's two groups, and the fact that they offer DIFFERENT verbs.
//
// Archived and Shipped look alike — both are lists of notes that are off the
// desk — and that is exactly why the distinction has to be pinned: one is work
// put aside and can come back, the other is the record of a milestone that
// landed and must not. A Restore button on a shipped note would rewrite a record
// through a drawer, and it would look perfectly reasonable on screen.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { NoteArchiveModal } from '../NoteArchiveModal';

const note = (id: string, status: NoteStatus, over: Partial<DevNote> = {}): DevNote =>
  ({
    id,
    projectId: 'p1',
    milestoneId: null,
    title: `Note ${id}`,
    bodyMd: '',
    status,
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: '2026-09-10T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...over,
  }) as DevNote;

const summary = (noteId: string, over: Partial<NotePlanSummary> = {}): NotePlanSummary => ({
  noteId,
  milestoneId: `ms-${noteId}`,
  milestoneStatus: 'shipped',
  goal: null,
  targetDate: null,
  cutAt: '2026-09-01T00:00:00.000Z',
  shippedAt: '2026-09-06T00:00:00.000Z',
  goalsTotal: 3,
  goalsDone: 3,
  ...over,
});

function drawer(over: Partial<Parameters<typeof NoteArchiveModal>[0]> = {}) {
  const onRestore = vi.fn().mockResolvedValue(undefined);
  const onFork = vi.fn().mockResolvedValue(undefined);
  render(
    <NoteArchiveModal
      notes={[note('filed', 'archived')]}
      shipped={[note('landed', 'shipped', { milestoneId: 'ms-landed' })]}
      summaries={{ landed: summary('landed') }}
      atCap={false}
      onRestore={onRestore}
      onFork={onFork}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { onRestore, onFork };
}

describe('NoteArchiveModal', () => {
  it('renders both groups, each with its own rows', () => {
    drawer();
    expect(screen.getByTestId('notepad-archived-filed')).toBeInTheDocument();
    const shipped = screen.getByTestId('notepad-shipped-group');
    expect(within(shipped).getByTestId('notepad-shipped-landed')).toBeInTheDocument();
  });

  // The whole point of the split. Restore is gated on the cap and would create
  // a live note out of a record; delete would erase one.
  it('offers Restore + Delete on an archived row and only Fork on a shipped one', () => {
    drawer();
    const archived = screen.getByTestId('notepad-archived-filed');
    expect(within(archived).getByRole('button', { name: /Restore/ })).toBeInTheDocument();

    const landed = screen.getByTestId('notepad-shipped-landed');
    expect(within(landed).getByRole('button', { name: /Fork/ })).toBeInTheDocument();
    expect(within(landed).queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(within(landed).queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('shows the cut → ship cycle time on a shipped row', () => {
    drawer();
    // 2026-09-01 → 2026-09-06 is five days.
    expect(screen.getByTestId('notepad-shipped-cycle-landed')).toHaveTextContent('5 days');
  });

  // A shipped note whose summary never arrived (the plan join is unreachable)
  // still has a title and still belongs in the drawer — it just cannot claim a
  // date it does not have.
  it('renders a shipped row with no summary, without inventing a stamp', () => {
    drawer({ summaries: {} });
    const landed = screen.getByTestId('notepad-shipped-landed');
    expect(landed).toHaveTextContent('Note landed');
    expect(screen.queryByTestId('notepad-shipped-cycle-landed')).toBeNull();
  });

  it('shows the empty state only when BOTH groups are empty', () => {
    drawer({ notes: [], shipped: [] });
    expect(screen.getByText('Nothing archived yet.')).toBeInTheDocument();
  });

  it('keeps the shipped group when nothing is archived', () => {
    drawer({ notes: [] });
    expect(screen.queryByText('Nothing archived yet.')).toBeNull();
    expect(screen.getByTestId('notepad-shipped-landed')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      shared: {
        kanban: {
          card_roledescription: 'Movable card',
          picked_up: 'Picked up. Use the arrow keys to choose a lane.',
          targeting: 'Lane: {column}',
          dropped: 'Moved to {column}. {count} in this lane.',
          cancelled: 'Move cancelled.',
        },
      },
    },
  }),
}));

import { KanbanBoard, type KanbanColumn } from '../KanbanBoard';

interface Goal {
  id: string;
  status: string;
  title: string;
}

const columns: KanbanColumn[] = [
  { id: 'todo', label: 'To do', statuses: ['todo'], targetStatus: 'todo' },
  { id: 'doing', label: 'In progress', statuses: ['doing'], targetStatus: 'doing' },
  // Display-only: owned by the backend orchestrator, no targetStatus.
  { id: 'archived', label: 'Archived', statuses: ['archived'] },
];

const items: Goal[] = [
  { id: 'g1', status: 'todo', title: 'Ship the thing' },
  { id: 'g2', status: 'doing', title: 'Already moving' },
];

function Board(props: { onItemMove?: (id: string, status: string) => void }) {
  return (
    <KanbanBoard<Goal>
      columns={columns}
      items={items}
      getItemId={(g) => g.id}
      getItemStatus={(g) => g.status}
      renderCard={(g) => <span>{g.title}</span>}
      ariaLabel="Goals"
      {...props}
    />
  );
}

const card = (title: string) => screen.getByText(title).parentElement as HTMLElement;
const live = () => screen.getByRole('status');

describe('KanbanBoard keyboard moves', () => {
  it('moves a card to the next droppable lane with Enter, arrows, Enter', () => {
    const onItemMove = vi.fn();
    render(<Board onItemMove={onItemMove} />);

    const first = card('Ship the thing');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('aria-roledescription', 'Movable card');

    fireEvent.keyDown(first, { key: 'Enter' });
    expect(live().textContent).toContain('Picked up');

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(live().textContent).toBe('Lane: In progress');

    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onItemMove).toHaveBeenCalledWith('g1', 'doing');
    // The announcement names the lane and its resulting size.
    expect(live().textContent).toBe('Moved to In progress. 2 in this lane.');
  });

  it('never targets a display-only lane from the keyboard', () => {
    const onItemMove = vi.fn();
    render(<Board onItemMove={onItemMove} />);
    const first = card('Ship the thing');

    fireEvent.keyDown(first, { key: 'Enter' });
    // Two droppable lanes exist; a third arrow press cannot reach `archived`.
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(live().textContent).toBe('Lane: In progress');

    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onItemMove).toHaveBeenCalledWith('g1', 'doing');
    expect(onItemMove).not.toHaveBeenCalledWith('g1', undefined);
  });

  it('Escape after pick-up cancels without moving anything', () => {
    const onItemMove = vi.fn();
    render(<Board onItemMove={onItemMove} />);
    const first = card('Ship the thing');

    fireEvent.keyDown(first, { key: 'Enter' });
    expect(first.className).toContain('opacity-40');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(first, { key: 'Escape' });

    expect(onItemMove).not.toHaveBeenCalled();
    expect(live().textContent).toBe('Move cancelled.');
    expect(first.className).not.toContain('opacity-40');
  });

  it('dropping a card back into its own lane is a no-op, not a move', () => {
    const onItemMove = vi.fn();
    render(<Board onItemMove={onItemMove} />);
    const first = card('Ship the thing');

    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onItemMove).not.toHaveBeenCalled();
  });

  it('ignores the cross-axis arrows so the page can still scroll', () => {
    render(<Board onItemMove={vi.fn()} />);
    const first = card('Ship the thing');
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    // Still on its own lane: ArrowDown belongs to `rows` boards.
    expect(live().textContent).toContain('Picked up');
  });

  it('takes no keys at all on a read-only board', () => {
    render(<Board />);
    const first = card('Ship the thing');
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(live().textContent).toBe('');
  });

  it('keeps the pointer drag path working', () => {
    const onItemMove = vi.fn();
    render(<Board onItemMove={onItemMove} />);
    const first = card('Ship the thing');
    expect(first).toHaveAttribute('draggable', 'true');

    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? '',
      types: ['application/x-personas-kanban-id'],
      effectAllowed: '',
      dropEffect: '',
    };
    fireEvent.dragStart(first, { dataTransfer });
    const doingLane = screen.getByText('In progress').closest('div')!.parentElement!;
    fireEvent.drop(doingLane, { dataTransfer });
    expect(onItemMove).toHaveBeenCalledWith('g1', 'doing');
  });
});

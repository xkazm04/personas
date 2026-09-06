// The three menus this replaced each had a different dismissal bug. These
// tests pin the union of what they were each missing, so the next one cannot
// regress quietly.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContextMenu, type ContextMenuItem } from '../ContextMenu';

const items = (over: Partial<ContextMenuItem>[] = []): ContextMenuItem[] => [
  { id: 'a', label: 'Alpha', onSelect: vi.fn(), ...over[0] },
  { id: 'b', label: 'Beta', onSelect: vi.fn(), ...over[1] },
  { id: 'c', label: 'Gamma', onSelect: vi.fn(), ...over[2] },
];

describe('ContextMenu', () => {
  it('renders a menu with one menuitem per entry', () => {
    render(<ContextMenu x={10} y={10} items={items()} onClose={vi.fn()} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('fires onSelect then closes', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<ContextMenu x={0} y={0} items={items([{ onSelect }])} onClose={onClose} />);
    fireEvent.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a disabled item', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <ContextMenu x={0} y={0} items={items([{ onSelect, disabled: true }])} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText('Alpha'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={items()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a scroll anywhere — a fixed menu whose anchor moved is a lie', () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={items()} onClose={onClose} />);
    fireEvent.scroll(document, {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus with the arrow keys, skipping disabled items', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        items={items([{}, { disabled: true }])}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole('menu');
    // The first enabled item takes focus on open.
    expect(document.activeElement).toHaveTextContent('Alpha');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    // Beta is disabled, so ArrowDown lands on Gamma rather than a dead stop.
    expect(document.activeElement).toHaveTextContent('Gamma');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toHaveTextContent('Alpha');
  });
});

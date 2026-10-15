/**
 * The tray — the frame that does not move while walking (mandate-lanes WP1):
 * scope and position, the walk and close controls, the stack's count of what
 * is left, the pending state, and the receipt of the last landed verdict.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeckTray } from '../DeckTray';
import { item } from '../../__tests__/rosterFixtures';

const queue = ['a', 'b', 'c'].map((id) => item({ id: `review:${id}`, kind: 'review' }));

describe('DeckTray', () => {
  it('says the scope and the position, and counts what is left on the stack', () => {
    render(<DeckTray scopeLabel="Gates" queue={queue} index={0}><div /></DeckTray>);
    expect(screen.getByText('Gates')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('of 3')).toBeTruthy();
    expect(screen.getByTestId('deck-stack-left').textContent).toContain('2');
  });

  it('walks both ways and closes; the ends disable their walk', () => {
    const onWalk = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<DeckTray scopeLabel="Gates" queue={queue} index={0} onWalk={onWalk} onClose={onClose}><div /></DeckTray>);
    expect((screen.getByRole('button', { name: 'Previous card' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(onWalk).toHaveBeenCalledWith(1);
    rerender(<DeckTray scopeLabel="Gates" queue={queue} index={2} onWalk={onWalk} onClose={onClose}><div /></DeckTray>);
    expect((screen.getByRole('button', { name: 'Next card' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('deck-stack-left')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    expect(onWalk).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByTestId('decision-deck-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pending: no position yet, and the Keys affordance waits for a card', () => {
    render(<DeckTray scopeLabel="Gates" queue={[]} index={0} pending><div data-testid="ghost" /></DeckTray>);
    expect(screen.queryByText(/^of /)).toBeNull();
    expect(screen.queryByText('empty')).toBeNull();
    expect(screen.queryByRole('button', { name: /Keys/ })).toBeNull();
    expect(screen.getByTestId('ghost')).toBeTruthy();
  });

  it('an empty queue says so in words', () => {
    render(<DeckTray scopeLabel="Gates" queue={[]} index={0}><div /></DeckTray>);
    expect(screen.getByText('empty')).toBeTruthy();
  });

  it('keeps the receipt of the last verdict in its live region, born empty', () => {
    const { rerender } = render(<DeckTray scopeLabel="Gates" queue={queue} index={0}><div /></DeckTray>);
    const region = screen.getByTestId('deck-receipt');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    rerender(<DeckTray scopeLabel="Gates" queue={queue} index={0} receipt="Accepted: Ship it"><div /></DeckTray>);
    expect(screen.getByTestId('deck-receipt').textContent).toBe('Accepted: Ship it');
  });

  it('the Keys button toggles the key map, which lists the fold key on an approval card', () => {
    const onKeys = vi.fn();
    const { rerender } = render(<DeckTray scopeLabel="Gates" queue={queue} index={0} onKeys={onKeys}><div /></DeckTray>);
    fireEvent.click(screen.getByRole('button', { name: /Keys/ }));
    expect(onKeys).toHaveBeenCalledWith(true);
    rerender(<DeckTray scopeLabel="Gates" queue={queue} index={0} onKeys={onKeys} keysOpen armsAccept><div /></DeckTray>);
    const map = screen.getByTestId('deck-key-legend');
    expect(map.textContent).toContain('open or close folded sections');
    expect(map.textContent).toContain('(arm, then confirm)');
  });
});

/**
 * The dock, layout by layout (decision-center deck, mandate-lanes WP1):
 *  - every verb carries its key INSIDE its own button (printed once);
 *  - chat: Reply (Space) lit, Done (D) quieter; report: Done (D), rating, branches;
 *    approval/backlog: Accept (A) lit, Reject (R) quieter, branches by digit, Later (S);
 *  - armed: the yes reads "↵ to confirm"; an irreversible item also says what leaves;
 *  - an open reason prompt replaces the dock.
 */
import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DeckDock } from '../DeckDock';
import { item } from '../../__tests__/rosterFixtures';
import type { DecisionItem } from '../../model/decisionModel';
import { fakeActions, fakeDeck } from './deckKit';

function mount(it: DecisionItem, over: Parameters<typeof fakeDeck>[1] = {}) {
  const deck = fakeDeck(it, over);
  const act = fakeActions(it);
  render(<DeckDock item={it} deck={deck} act={act} rating={null} onRate={() => {}} />);
  return { deck, act };
}

/** The key printed inside the named button. */
function keyIn(name: string | RegExp): string {
  const kbd = within(screen.getByRole('button', { name })).getAllByText((_, el) => el?.tagName === 'KBD');
  return kbd.map((k) => k.textContent).join(' ');
}

const review = item({
  id: 'review:1', kind: 'review', title: 'Ship the parser',
  verdictLabels: { accept: 'Approve', reject: 'Reject', skip: 'Later' },
  branches: [{ id: 'retry', label: 'Retry the step', hint: 'Runs it again' }],
});

describe('DeckDock', () => {
  it('approval layout: the verdict pair, a digit branch and Later, each key inside its button', () => {
    const { act } = mount(review);
    expect(keyIn('Approve')).toBe('A');
    expect(keyIn('Reject')).toBe('R');
    expect(keyIn('Retry the step: Runs it again')).toBe('1');
    expect(keyIn(/Later/)).toBe('S');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(act.accept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry the step: Runs it again' }));
    expect(act.branch).toHaveBeenCalledWith(1);
  });

  it('the yes is lit and the no is quieter', () => {
    mount(review);
    expect(screen.getByRole('button', { name: 'Approve' }).className).toContain('au-verdict-yes');
    expect(screen.getByRole('button', { name: 'Reject' }).className).toContain('au-verdict-no');
  });

  it('report layout: Done with D, the rating, and follow-up branches by digit', () => {
    const report = item({
      id: 'report:1', kind: 'report', title: 'Weekly digest',
      branches: [{ id: 'chat', label: 'Follow up in chat' }],
      verdictLabels: { accept: 'Mark read', reject: 'Dismiss', skip: 'Later' },
    });
    const { act } = mount(report);
    expect(keyIn('Done, mark read')).toBe('D');
    expect(keyIn('Follow up in chat')).toBe('1');
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done, mark read' }));
    expect(act.done).toHaveBeenCalledTimes(1);
  });

  it('chat layout: Reply with Space, Done with D', () => {
    const chat = item({ id: 'message:team:1', kind: 'message', title: 'Team asks', verdictLabels: { accept: 'Done', reject: 'Dismiss', skip: 'Later' } });
    const { act } = mount(chat);
    expect(keyIn('Reply')).toBe('Space');
    expect(keyIn('Done')).toBe('D');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(act.done).toHaveBeenCalledTimes(1);
  });

  it('an armed reject reads as a confirm, in place', () => {
    mount(review, { armed: 'reject' });
    const no = screen.getByRole('button', { name: 'Reject, press Enter to confirm' });
    expect(no.hasAttribute('data-armed')).toBe(true);
    expect(within(no).getByText('↵ to confirm')).toBeTruthy();
    expect(screen.queryByTestId('deck-armed-box')).toBeNull();
  });

  it('an irreversible item prints the confirm key and, armed, says exactly what leaves', () => {
    const valve = { ...review, irreversible: 'deletion' as const };
    mount(valve);
    expect(keyIn('Approve')).toBe('A ↵');
    expect(screen.queryByTestId('deck-armed-box')).toBeNull();
    cleanup();

    mount(valve, { armed: 'accept' });
    const box = screen.getByTestId('deck-armed-box');
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.textContent).toContain('Deleted for good, with no undo: Ship the parser');
    expect(box.textContent).toContain('disarms, nothing happens');
    expect(screen.getByRole('button', { name: 'Approve, press Enter to confirm' }).hasAttribute('data-armed')).toBe(true);
  });

  it('an open reason prompt replaces the dock', () => {
    mount(review, { prompt: { on: 'reject', title: 'Why reject?', options: [], skipLabel: 'Skip', freeText: true } });
    expect(screen.getByTestId('deck-reason')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});

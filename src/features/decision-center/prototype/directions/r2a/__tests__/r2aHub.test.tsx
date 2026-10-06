/**
 * R2-A keeps P2's behaviour: the same keyboard grammar end to end on the
 * fixture roster (strip -> peek -> deck, walk, A, R+R, R+R+digit reason,
 * queue empties back to the peek, Esc closes it), the Esc ladder with the
 * new key map in front of it, and the composer typing guard.
 */
import { useState } from 'react';
import { describe, it, expect, vi, afterAll } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: (props: { content: string }) => <div>{props.content}</div>,
}));

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import direction from '..';
import { FIXTURE_ITEMS, FIXTURE_READY, fixtureCounts } from '../../../fixtures';
import { compareDecision } from '../../../../model/decisionOrder';
import type { HubInitial, PrototypeVerdict } from '../../../directionContract';

const SORTED = [...FIXTURE_ITEMS].sort(compareDecision);
const originals = {
  scrollBy: Element.prototype.scrollBy,
  scrollTo: Element.prototype.scrollTo,
  scrollIntoView: Element.prototype.scrollIntoView,
};
Element.prototype.scrollBy = vi.fn() as unknown as Element['scrollBy'];
Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
afterAll(() => Object.assign(Element.prototype, originals));

function Lab({ initial, log }: { initial: HubInitial; log: (v: PrototypeVerdict) => void }) {
  const [items, setItems] = useState(SORTED);
  const Hub = direction.Hub;
  return (
    <AppKeyboardProvider>
      <Hub
        items={items}
        ready={FIXTURE_READY}
        counts={fixtureCounts(items, FIXTURE_READY)}
        initial={initial}
        onDecide={(v) => {
          log(v);
          if (v.verdict !== 'skip') setItems((xs) => xs.filter((x) => x.id !== v.item.id));
        }}
      />
    </AppKeyboardProvider>
  );
}

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
  act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...extra }); });
const heading = () => screen.queryByRole('dialog')?.querySelector('h2')?.textContent;

describe('R2-A hub keeps the P2 grammar', () => {
  it('walks strip -> peek -> deck, decides, and steps back down', async () => {
    const log = vi.fn();
    render(<Lab initial={{ level: 'strip' }} log={log} />);

    fireEvent.click(screen.getByTestId('r2a-chip-gates'));
    const peek = await screen.findByTestId('r2a-peek');
    const rows = () => Array.from(peek.querySelectorAll('[data-focused]'));
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toHaveAttribute('data-focused', 'true');
    key('ArrowDown');
    expect(rows()[1]).toHaveAttribute('data-focused', 'true');
    key('ArrowUp');
    key('Enter');
    await waitFor(() => expect(heading()).toBe('Send the ACME follow-up sequence?'));

    key('ArrowRight');
    await waitFor(() => expect(heading()).toBe('Athena wants to pause the CRM Sync schedule'));

    key('a');
    await waitFor(() => expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'accept', item: expect.objectContaining({ id: 'approval:a1' }) })));
    await waitFor(() => expect(heading()).toBe('Invoice Parser needs two answers to continue building'));

    // R arms ("↵ to confirm" in the dock), a second R confirms.
    key('r');
    expect(await screen.findByText('↵ to confirm')).toBeInTheDocument();
    key('r');
    await waitFor(() => expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reject', item: expect.objectContaining({ id: 'question:q1' }) })));
    await waitFor(() => expect(heading()).toBe('Send the ACME follow-up sequence?'));

    // R, R opens the reason prompt; a digit picks the reason and decides.
    key('r');
    key('r');
    await screen.findByText('Why reject?');
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: '2', code: 'Digit2' }); });
    await waitFor(() => expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reject', reason: 'discount not allowed' })));

    // The queue is empty: the deck steps back to the peek it came from, then Esc closes the peek.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('r2a-peek')).toBeInTheDocument();
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('r2a-peek')).toBeNull());
  });

  it('prints each key once, in its button; the full map sits behind ? and Esc closes it first', async () => {
    const log = vi.fn();
    render(<Lab initial={{ level: 'modal', type: 'approval' }} log={log} />);
    await waitFor(() => expect(heading()).toBe('Lead Researcher: credential expired (LinkedIn)'));
    expect(screen.queryByTestId('r2a-key-legend')).toBeNull();
    expect(screen.getByTestId('r2a-yes-band').querySelector('kbd')).toBeNull();

    key('?', { shiftKey: true });
    expect(await screen.findByTestId('r2a-keymap')).toBeInTheDocument();
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('r2a-keymap')).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    key('r');
    expect(await screen.findByText('↵ to confirm')).toBeInTheDocument();
    key('Escape');
    await waitFor(() => expect(screen.queryByText('↵ to confirm')).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    key('Escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(log).not.toHaveBeenCalled();
  });

  it('letters typed in the chat composer decide nothing; Enter sends the reply', async () => {
    const log = vi.fn();
    render(<Lab initial={{ level: 'modal', type: 'chat' }} log={log} />);
    const composer = await screen.findByTestId('r2a-composer');
    key(' ');
    expect(document.activeElement).toBe(composer);
    fireEvent.keyDown(composer, { key: 'a' });
    fireEvent.keyDown(composer, { key: 'd' });
    expect(log).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: 'Drop it.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reply', text: 'Drop it.' })));
  });
});

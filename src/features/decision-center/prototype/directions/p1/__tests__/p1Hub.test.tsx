/**
 * P1 keyboard grammar, end to end on the fixture roster:
 * strip -> peek (↑/↓, Enter) -> modal (→ walk, A accept, R+Enter reject,
 * R+Enter+digit reason) -> item leaves -> queue empties -> Esc closes the peek.
 * Plus the typing guard: letters typed in the chat composer decide nothing.
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
import type { HubInitial, PrototypeVerdict } from '../../../directionContract';

const scrollBy = vi.fn();
const originalScrollBy = Element.prototype.scrollBy;
const originalScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollBy = scrollBy as unknown as Element['scrollBy'];
Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
const originalScrollTo = Element.prototype.scrollTo;
Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
afterAll(() => {
  Element.prototype.scrollBy = originalScrollBy;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.scrollTo = originalScrollTo;
});

function Lab({ initial, log }: { initial: HubInitial; log: (v: PrototypeVerdict) => void }) {
  const [items, setItems] = useState(FIXTURE_ITEMS);
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

// Fired on body like a real keystroke, so it bubbles through document (useClickOutside) to window (the keyboard ladder).
const key = (k: string) => act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: k }); });
const heading = () => screen.getByRole('dialog').querySelector('h2')?.textContent;

describe('P1 hub keyboard grammar', () => {
  it('walks strip -> peek -> modal, decides, and steps back with Esc', async () => {
    const log = vi.fn();
    render(<Lab initial={{ level: 'strip' }} log={log} />);

    fireEvent.click(screen.getByTestId('p1-chip-gates'));
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    key('ArrowDown');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    key('ArrowUp');
    key('Enter');
    await waitFor(() => expect(heading()).toBe('Send the ACME follow-up sequence?'));

    key('ArrowRight');
    await waitFor(() => expect(heading()).toBe('Athena wants to pause the CRM Sync schedule'));

    key('a');
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'accept', item: expect.objectContaining({ id: 'approval:a1' }) }));
    await waitFor(() => expect(heading()).toBe('Invoice Parser needs two answers to continue building'));

    // R arms, Enter confirms (no reason prompt on this item).
    key('r');
    expect(log).toHaveBeenCalledTimes(1);
    key('Enter');
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reject', item: expect.objectContaining({ id: 'question:q1' }) }));
    await waitFor(() => expect(heading()).toBe('Send the ACME follow-up sequence?'));

    // R, Enter opens the reason prompt; a digit picks the reason and decides.
    key('r');
    key('Enter');
    await screen.findByText('Why reject?');
    key('2');
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reject', reason: 'discount not allowed' }));

    // The queue is empty: the sheet closes back to the peek, then Esc closes the peek.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('p1-peek')).toBeInTheDocument();
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('p1-peek')).toBeNull());
  });

  it('Esc steps back one level at a time: armed -> idle -> closed', async () => {
    const log = vi.fn();
    render(<Lab initial={{ level: 'modal', type: 'approval' }} log={log} />);
    await waitFor(() => expect(heading()).toBe('Send the ACME follow-up sequence?'));
    key('r');
    expect(await screen.findByText('Reject this?')).toBeInTheDocument();
    key('Escape');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Reject this?')).toBeNull());
    key('Escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(log).not.toHaveBeenCalled();
  });

  it('letters typed in the chat composer decide nothing; Enter sends the reply', async () => {
    const log = vi.fn();
    render(<Lab initial={{ level: 'modal', type: 'chat' }} log={log} />);
    const composer = await screen.findByRole('textbox', { name: 'Write a reply' });
    key(' ');
    expect(document.activeElement).toBe(composer);
    fireEvent.keyDown(composer, { key: 'a' });
    fireEvent.keyDown(composer, { key: 'd' });
    expect(log).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: 'Drop it.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reply', text: 'Drop it.' }));
  });
});

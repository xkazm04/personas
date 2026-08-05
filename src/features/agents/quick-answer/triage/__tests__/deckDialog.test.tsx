/**
 * Decidable by keyboard.
 *
 * Three separate failures, all on the same surface and all verified before the
 * fix:
 *
 *  (a) The prose scroller had no `tabIndex` and no focusable descendant, and
 *      the deck bound no vertical keys — `←`/`→` are verdicts. A review with a
 *      40-line description was therefore UNDECIDABLE by keyboard: you could
 *      read the first screenful and nothing else, then rule on it.
 *  (b) The deck was a bare `motion.section` with an `aria-label`. Tab walked
 *      into the route still rendered underneath, and on close focus landed on
 *      `<body>` — so reopening the queue meant tabbing from the top of the app.
 *  (c) Both drag stamps carried a permanent `role="status" aria-live="polite"`
 *      and sat in the DOM for every top card, so a screen reader announced
 *      "Reject… Approve" on every deal and buried the card's own title.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: (props: { content: string }) => <div>{props.content}</div>,
}));

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';

import { TriageDeckVariant } from '../TriageDeckVariant';
import { emptyCounts, type TriageItem } from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import { makeItem } from './triageFixtures';

// jsdom implements neither on elements; the assertions are on the calls.
const scrollBy = vi.fn();
const scrollTo = vi.fn();
const originalScrollBy = Element.prototype.scrollBy;
const originalScrollTo = Element.prototype.scrollTo;
Element.prototype.scrollBy = scrollBy as unknown as Element['scrollBy'];
Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
afterAll(() => {
  Element.prototype.scrollBy = originalScrollBy;
  Element.prototype.scrollTo = originalScrollTo;
});

function makeQueue(items: TriageItem[], decide = vi.fn().mockResolvedValue(undefined)) {
  const queue: UnifiedTriageQueue = {
    items,
    allCounts: emptyCounts(),
    loading: false,
    activeKinds: new Set(['review', 'idea', 'practice', 'question']),
    toggleKind: vi.fn(),
    decidedCount: 0,
    sessionTotal: items.length,
    deferredCount: 0,
    skips: new Map(),
    backlog: { loaded: items.length, pending: items.length, hasMore: false },
    loadMore: vi.fn(),
    decide,
    openLink: vi.fn(),
    reload: vi.fn(),
    focusItem: vi.fn(),
  };
  return { queue, decide };
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const deckRoot = () => screen.getByTestId('triage-deck-variant');
const focusables = () => Array.from(deckRoot().querySelectorAll<HTMLElement>(FOCUSABLE));
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

function renderDeck(items: TriageItem[], onClose = vi.fn()) {
  const { queue, decide } = makeQueue(items);
  const view = render(
    <AppKeyboardProvider>
      <TriageDeckVariant queue={queue} onClose={onClose} title="Triage" />
    </AppKeyboardProvider>,
  );
  return { ...view, decide, onClose };
}

beforeEach(() => {
  scrollBy.mockClear();
  scrollTo.mockClear();
});

describe('the card body is readable by keyboard alone', () => {
  it('scrolls on the vertical keys and records NO verdict for any of them', () => {
    const { decide } = renderDeck([makeItem('review', { body: 'a very long body' })]);

    press('ArrowDown');
    press('ArrowUp');
    press('PageDown');
    press('PageUp');
    press('Home');
    press('End');

    // Reserved for reading. If any of these ever became a verdict, a reviewer
    // scrolling to the bottom of a long review would approve it on the way.
    expect(decide).not.toHaveBeenCalled();
    expect(scrollBy).toHaveBeenCalledTimes(4);
    expect(scrollBy.mock.calls.map(([arg]) => Math.sign(arg.top))).toEqual([1, -1, 1, -1]);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('still decides on the horizontal keys', async () => {
    const { decide } = renderDeck([makeItem('idea')]);
    press('ArrowRight');
    // The card is thrown first and the verdict lands once the flight is seen.
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept' })),
    );
  });

  it('exposes the scroller as a focusable, named region', () => {
    renderDeck([makeItem('practice')]);
    const region = screen.getByRole('region');
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute('aria-label')).toBeTruthy();
    expect(region.className).toContain('overflow-y-auto');
  });
});

describe('the deck is a dialog', () => {
  it('declares the contract and takes focus into the body, not a filter chip', async () => {
    renderDeck([makeItem('review')]);

    const root = deckRoot();
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('aria-label')).toBeTruthy();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region')));
  });

  it('cycles Tab inside the deck instead of walking into the route underneath', async () => {
    renderDeck([makeItem('idea')]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region')));

    const all = focusables();
    const first = all[0]!;
    const last = all[all.length - 1]!;
    expect(all.length).toBeGreaterThan(1);

    last.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);

    first.focus();
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Focus that has escaped to <body> — what every verdict used to cause —
    // is pulled back in rather than let out into the route.
    (document.activeElement as HTMLElement).blur();
    press('Tab');
    expect(document.activeElement).toBe(first);
  });

  it('restores focus to the control that opened it', async () => {
    const { queue } = makeQueue([makeItem('practice')]);
    const Host = ({ open }: { open: boolean }) => (
      <>
        <button data-testid="trigger" type="button">
          open
        </button>
        <AppKeyboardProvider>
          {open ? <TriageDeckVariant queue={queue} onClose={vi.fn()} title="Triage" /> : null}
        </AppKeyboardProvider>
      </>
    );

    const { rerender } = render(<Host open={false} />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Host open />);
    await waitFor(() => expect(document.activeElement).not.toBe(trigger));

    rerender(<Host open={false} />);
    // Without this the reviewer lands on <body> and has to tab from the top of
    // the app to reopen the queue they were working through.
    expect(document.activeElement).toBe(trigger);
  });
});

describe('one live region, not two stamps', () => {
  it('announces the card being presented and nothing else', async () => {
    const item = makeItem('idea', { title: 'Cache the practice fan-out' });
    const { container } = renderDeck([item]);

    // The two drag stamps used to be live regions of their own, so every deal
    // spoke "Reject… Approve" before the title ever got a chance.
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);

    const live = container.querySelector('[aria-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    // Empty on first paint: a region that already holds its text is not a
    // change, and most screen readers stay silent for it.
    await waitFor(() => expect(live.textContent).toContain('Cache the practice fan-out'));
  });

  it('speaks the verdict it actually recorded, then the next card', async () => {
    const first = makeItem('idea', { title: 'First idea' });
    const second = makeItem('review', { title: 'Second review' });
    const { queue } = makeQueue([first, second]);
    const { container, rerender } = render(
      <AppKeyboardProvider>
        <TriageDeckVariant queue={queue} onClose={vi.fn()} title="Triage" />
      </AppKeyboardProvider>,
    );

    const live = container.querySelector('[aria-live]')!;
    press('ArrowLeft');
    // The verdict is announced in the item's OWN words, sourced from the single
    // call that writes it — the announcement cannot drift from the record.
    await waitFor(() => expect(live.textContent).toContain(first.verdictLabels.reject));

    const { queue: after } = makeQueue([second]);
    rerender(
      <AppKeyboardProvider>
        <TriageDeckVariant queue={after} onClose={vi.fn()} title="Triage" />
      </AppKeyboardProvider>,
    );

    await waitFor(() => expect(live.textContent).toContain('Second review'));
    expect(live.textContent).toContain(first.verdictLabels.reject);
  });
});

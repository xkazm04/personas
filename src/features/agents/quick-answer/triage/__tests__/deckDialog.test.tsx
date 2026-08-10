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

import { AriaLiveProvider } from '@/features/shared/components/feedback/AriaLiveProvider';
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
    cursor: 0,
    allCounts: emptyCounts(),
    loading: false,
    failures: [],
    activeKinds: new Set(['review', 'idea', 'practice', 'question']),
    toggleKind: vi.fn(),
    showAllKinds: vi.fn(),
    decidedCount: 0,
    sessionTotal: items.length,
    deferredCount: 0,
    skips: new Map(),
    backlog: {
      loaded: items.length,
      pending: items.length,
      hasMore: false,
      remaining: 0,
      capped: [],
      more: false,
    },
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

/**
 * The deck as it is actually mounted: under the app's live-region provider.
 *
 * `TrayOverlays` renders it inside `App`'s `AriaLiveProvider`, and the deck now
 * announces through that provider rather than hand-rolling a region of its own.
 */
function Deck({ queue, onClose }: { queue: UnifiedTriageQueue; onClose: () => void }) {
  return (
    <AriaLiveProvider>
      <AppKeyboardProvider>
        <TriageDeckVariant queue={queue} onClose={onClose} title="Triage" />
      </AppKeyboardProvider>
    </AriaLiveProvider>
  );
}

function renderDeck(items: TriageItem[], onClose = vi.fn()) {
  const { queue, decide } = makeQueue(items);
  const view = render(<Deck queue={queue} onClose={onClose} />);
  return { ...view, decide, onClose };
}

/** The app's polite region — the one the deck speaks into. */
const politeRegion = (container: HTMLElement) =>
  container.querySelector('[aria-live="polite"]') as HTMLElement;

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
        {open ? <Deck queue={queue} onClose={vi.fn()} /> : null}
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

describe('one live region, and the deck does not own it', () => {
  it('contributes NO live region of its own', () => {
    renderDeck([makeItem('idea', { alert: { id: 'held', label: 'Blocking', tone: 'warning' } })]);

    // Three claims that were all false while the deck hand-rolled a region:
    // the drag stamps were live, the alert banner carried `role="status"` (an
    // implicit polite region) on EVERY mounted card, and the deck's own div was
    // a fourth. `role="status"` counts even without an `aria-live` attribute —
    // which is exactly why the old assertion, querying `[aria-live]` alone,
    // reported "one" while three more were speaking.
    const deck = deckRoot();
    expect(deck.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('announces the card being presented through the app’s polite region', async () => {
    const item = makeItem('idea', { title: 'Cache the practice fan-out' });
    const { container } = renderDeck([item]);

    // Empty on first paint: a region that already holds its text is not a
    // change, and most screen readers stay silent for it.
    await waitFor(() => expect(politeRegion(container).textContent).toContain(item.title));
  });

  it('announces the alert that changes what the decision MEANS', async () => {
    // `TriageAlert` is "the ONE fact that changes what the decision means" — a
    // review holding a team step, a promotion pinned to a stale persona. Its
    // banner carried `role="status"` per mounted card and that had to go; what
    // must NOT follow is the fact going unannounced, on a surface where `←`/`→`
    // decides without the card ever being read.
    const item = makeItem('review', {
      title: 'Rotate the leaked key',
      alert: {
        id: 'held',
        label: 'Blocking a team step',
        detail: 'A held step is waiting on this — approving it resumes the work.',
        tone: 'warning',
      },
    });
    const { container } = renderDeck([item]);

    await waitFor(() =>
      expect(politeRegion(container).textContent).toContain('Blocking a team step'),
    );
    // The label, not the detail: the label is the interrupt, the detail is a
    // sentence of consequence and this is a keyboard-speed surface.
    expect(politeRegion(container).textContent).not.toContain('A held step is waiting');
    expect(politeRegion(container).textContent).toContain('Rotate the leaked key');
  });

  it('makes a card WITHOUT an alert pay nothing for the rare one', async () => {
    const item = makeItem('idea', { title: 'Cache the practice fan-out' });
    const { container } = renderDeck([item]);

    // Byte-identical to the utterance before the alert existed. The alert
    // composes through its own key precisely so an ordinary card carries no
    // dangling separator.
    await waitFor(() =>
      expect(politeRegion(container).textContent).toBe(
        'Now deciding: Idea — Cache the practice fan-out',
      ),
    );
  });

  it('speaks the verdict it actually recorded, then the next card', async () => {
    const first = makeItem('idea', { title: 'First idea' });
    const second = makeItem('review', { title: 'Second review' });
    const { queue } = makeQueue([first, second]);
    const { container, rerender } = render(<Deck queue={queue} onClose={vi.fn()} />);

    press('ArrowLeft');
    // The verdict is announced in the item's OWN words, sourced from the single
    // call that writes it — the announcement cannot drift from the record.
    await waitFor(() =>
      expect(politeRegion(container).textContent).toContain(first.verdictLabels.reject),
    );

    const { queue: after } = makeQueue([second]);
    rerender(<Deck queue={after} onClose={vi.fn()} />);

    await waitFor(() => expect(politeRegion(container).textContent).toContain('Second review'));
  });

  it('speaks two IDENTICAL consecutive verdicts as two utterances', async () => {
    // The failure this pins is silent by construction: a live region only
    // speaks when its content mutates, so rejecting two cards whose verdict
    // reads the same way used to produce one utterance and one silence. The
    // provider queues each message and bumps a `key`, so the region is a NEW
    // element per utterance — that remount is the utterance.
    const a = makeItem('idea', { title: 'Same words' });
    const b = makeItem('idea', { title: 'Same words' });
    const { queue: firstQueue } = makeQueue([a, b]);
    const { container, rerender } = render(<Deck queue={firstQueue} onClose={vi.fn()} />);

    press('ArrowLeft');
    await waitFor(() =>
      expect(politeRegion(container).textContent).toContain(a.verdictLabels.reject),
    );

    const { queue: secondQueue } = makeQueue([b]);
    rerender(<Deck queue={secondQueue} onClose={vi.fn()} />);
    // Let the next card's own announcement land first, so what follows can only
    // be the second verdict.
    await waitFor(() =>
      expect(politeRegion(container).textContent).not.toContain(b.verdictLabels.reject),
    );
    const beforeSecondVerdict = politeRegion(container);

    press('ArrowLeft');
    // Same words, and still a second utterance: a NEW element carrying the same
    // text is a screen reader hearing it again. The old hand-rolled region
    // mutated in place, so this second rejection was recorded in silence.
    await waitFor(() => {
      const region = politeRegion(container);
      expect(region).not.toBe(beforeSecondVerdict);
      expect(region.textContent).toContain(b.verdictLabels.reject);
    });
  });
});

describe('only the card being decided is in the tab ring', () => {
  it('leaves the two cards behind the top one out of the tab order', () => {
    // All three stacked cards render the prose scroller. Two of them sit under
    // `pointer-events-none`, which removes the mouse but NOT the tab order — so
    // an unconditional `tabIndex={0}` cost two invisible tab stops per deal.
    renderDeck([makeItem('review'), makeItem('idea'), makeItem('practice')]);

    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(3);
    expect(regions.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    expect(focusables().filter((el) => el.getAttribute('role') === 'region')).toHaveLength(1);
  });
});

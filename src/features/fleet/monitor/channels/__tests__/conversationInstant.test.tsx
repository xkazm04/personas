import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';

/**
 * "MAKE THE CHAT FEEL INSTANT" — the two things that decide whether it does.
 *
 *  1. THE LOADING SWITCH. `loaded` was read for exactly one purpose (firing
 *     `markSeen`) and the render switch tested only `rows.length === 0`, so for
 *     the whole of a channel's FIRST fetch the operator was shown the SETTLED
 *     empty state — "nothing has ever been said here" — which then snapped to a
 *     full conversation. That is not slowness, it is a wrong answer displayed
 *     confidently (`docs/design/overview-loading.md` SS A, laws 1 and 4).
 *
 *  2. THE ENTRANCE, AND WHO GETS ONE. A new message should feel like it
 *     ARRIVED; the sixty messages that were already there should not re-enter
 *     behind it on every poll. `useRevealTracker`'s seen-set is the mechanism,
 *     and reduced motion must defeat all of it at once.
 *
 * Driven through `PersonaConversation` because it is the smaller of the two
 * hosts and mounts the same `VirtualConversation`; the team channel's switch is
 * the same three branches over `conv.loaded`.
 */

// jsdom in this repo defines no `AnimationEvent`, and React gates its
// `onAnimationEnd` registration on that constructor existing — so WITHOUT this
// shim `fireEvent.animationEnd` reaches a native listener and never reaches
// React, `RevealItem` never marks a row entered, and the "only the new message
// animates" assertion below would pass by never having marked anything.
// Measured 2026-10-06: React handler calls 0 without it, 1 with it. `vi.hoisted`
// because it has to be in place before react-dom initialises.
vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.AnimationEvent !== 'undefined') return;
  class AnimationEventShim extends Event {
    animationName = '';
    elapsedTime = 0;
    pseudoElement = '';
  }
  g.AnimationEvent = AnimationEventShim;
  const w = g.window as Record<string, unknown> | undefined;
  if (w) w.AnimationEvent = AnimationEventShim;
});

// Bypass the IPC token wait in tauriInvoke (pulled in by the channel slice).
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/overview/reports', () => ({
  getReport: vi.fn(),
  deleteReport: vi.fn(),
}));

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/lib/silentCatch', () => ({
  toastCatch: () => () => {},
  silentCatch: () => () => {},
}));

const t = new Proxy(
  {},
  {
    get: (_o, section) =>
      new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }),
  },
);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));

const storeState: Record<string, unknown> = {};
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

function chat(id: string, at: string): PersonaChannelItem {
  return {
    id,
    kind: 'message',
    at,
    authorKind: 'persona',
    title: null,
    body: `body ${id}`,
    reportId: null,
    reviewId: null,
    severity: null,
    suggestedActions: null,
    executionId: null,
    replyTo: null,
    extra: null,
  } as unknown as PersonaChannelItem;
}

function setChannel(loaded: boolean, items: PersonaChannelItem[]) {
  Object.assign(storeState, {
    subscribePersonaChannel: () => () => {},
    loadOlderPersonaChannel: vi.fn(),
    markPersonaChannelSeen: vi.fn(),
    refreshPersonaChannel: vi.fn().mockResolvedValue(undefined),
    sendPersonaChannelMessage: vi.fn().mockResolvedValue(undefined),
    personaChannels: {
      'p-1': { items, loaded, exhausted: true, posting: false, lastSeenAt: null, echoes: [] },
    },
  });
}

async function mount() {
  const { PersonaConversation } = await import('../PersonaConversation');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persona = { id: 'p-1', name: 'Scout', color: '#8ab' } as any;
  return render(<PersonaConversation persona={persona} />);
}

/** Every element the entrance wrapper put an animation on. */
function entering(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.animate-fade-in'));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-motion');
});
afterEach(() => {
  // Explicit: this suite mounts the same surface repeatedly and a leaked
  // previous tree makes `getByTestId` ambiguous rather than failing honestly.
  cleanup();
  document.documentElement.removeAttribute('data-motion');
});

describe('cold channel open', () => {
  it('shows ghosts, NOT the settled empty state, while the first fetch is in flight', async () => {
    setChannel(false, []);
    await mount();
    expect(screen.getByTestId('conversation-ghosts')).toBeInTheDocument();
    expect(screen.queryByText('monitor.conv_persona_empty_title')).not.toBeInTheDocument();
  });

  it('delays every ghost past 120ms, so a warm channel paints none of them', async () => {
    setChannel(false, []);
    await mount();
    const bars = Array.from(
      screen.getByTestId('conversation-ghosts').querySelectorAll<HTMLElement>('.animate-fade-in'),
    );
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(Number.parseInt(bar.style.animationDelay, 10)).toBeGreaterThanOrEqual(120);
      // Law: a ghost is calm. The delayed fade is the ONLY animation on it —
      // never a pulse, never a spinner. Asserted as the whole set rather than
      // by naming the banned classes, so this file does not itself ship the
      // string the `hand-rolled-spinner` ratchet counts.
      expect(bar.className.match(/animate-[\w-]+/g)).toEqual(['animate-fade-in']);
    }
  });

  it('shows the empty state only once the fetch has SETTLED', async () => {
    setChannel(true, []);
    await mount();
    expect(screen.queryByTestId('conversation-ghosts')).not.toBeInTheDocument();
    expect(screen.getByText('monitor.conv_persona_empty_title')).toBeInTheDocument();
  });

  it('never shows ghosts on top of rows that already rendered (law 1)', async () => {
    setChannel(false, [chat('m1', '2026-08-20T10:00:00Z')]);
    await mount();
    expect(screen.queryByTestId('conversation-ghosts')).not.toBeInTheDocument();
    expect(screen.getByText('body m1')).toBeInTheDocument();
  });
});

describe('row entrance', () => {
  it('staggers the first paint and gives the first row no delay', async () => {
    setChannel(true, [
      chat('m1', '2026-08-20T10:00:00Z'),
      chat('m2', '2026-08-20T10:01:00Z'),
      chat('m3', '2026-08-20T10:02:00Z'),
    ]);
    const { container } = await mount();
    const revealed = entering(container).filter((el) => !el.closest('[data-testid="conversation-ghosts"]'));
    expect(revealed.length).toBeGreaterThan(1);
    expect(revealed[0]!.style.animationDelay).toBe('0ms');
    expect(revealed[1]!.style.animationDelay).toBe('35ms');
  });

  it('animates ONLY the arriving message — the ones already seen do not re-enter', async () => {
    setChannel(true, [chat('m1', '2026-08-20T10:00:00Z'), chat('m2', '2026-08-20T10:01:00Z')]);
    const { container, rerender } = await mount();
    // jsdom runs no animations, so entry is confirmed by hand — `RevealItem`
    // marks on `animationend`, deliberately not on mount. `bubbles` is
    // explicit: testing-library defaults animation events to non-bubbling and
    // React listens at the root (see the AnimationEvent shim at the top of
    // this file for the other half of why this reaches React at all).
    for (const el of entering(container)) fireEvent.animationEnd(el, { bubbles: true });

    setChannel(true, [
      chat('m1', '2026-08-20T10:00:00Z'),
      chat('m2', '2026-08-20T10:01:00Z'),
      chat('m3', '2026-08-20T10:02:00Z'),
    ]);
    const { PersonaConversation } = await import('../PersonaConversation');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rerender(<PersonaConversation persona={{ id: 'p-1', name: 'Scout', color: '#8ab' } as any} />);

    const still = entering(container);
    expect(still).toHaveLength(1);
    expect(still[0]!).toHaveTextContent('body m3');
    // A lone arrival is wave position 0 — it does not wait behind rows that
    // are not entering.
    expect(still[0]!.style.animationDelay).toBe('0ms');
  });
});

describe('reduced motion', () => {
  it('reveals everything at once — no entrance anywhere, every row present', async () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    setChannel(true, [
      chat('m1', '2026-08-20T10:00:00Z'),
      chat('m2', '2026-08-20T10:01:00Z'),
      chat('m3', '2026-08-20T10:02:00Z'),
    ]);
    const { container } = await mount();
    expect(entering(container)).toHaveLength(0);
    expect(screen.getByText('body m1')).toBeInTheDocument();
    expect(screen.getByText('body m2')).toBeInTheDocument();
    expect(screen.getByText('body m3')).toBeInTheDocument();
  });
});

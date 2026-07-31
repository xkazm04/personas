/**
 * No keypress decides two rows.
 *
 * The deck renders OVER the live route — `TrayOverlays` mounts it and nothing
 * beneath it unmounts — so every route-level decision surface underneath is
 * still mounted and, until this change, still listening on `window`. A reviewer
 * on Approvals → Backlog → Focus who opened the deck and pressed `←` twice had
 * rejected TWO backlog ideas: one on the card in front of them, one behind an
 * opaque overlay. `preventDefault()` does not stop a sibling `window` listener.
 *
 * The fix is the app's own keyboard registry, and specifically its EXCLUSIVE
 * mode: priority alone only decides who sees a key first, which still leaks
 * every key the deck happens not to bind (`a` / `z` reject and accept a backlog
 * idea; `Shift+←` slips past the deck's modifier bail-out straight into the
 * review flow, which never checked modifiers). So the assertion below is not
 * "the deck wins the arrows" — it is that NOTHING underneath is called at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import {
  AppKeyboardProvider,
  ROUTE_DECISION_PRIORITY,
  useAppKeyboard,
} from '@/lib/keyboard/AppKeyboardProvider';

import { useDeckControls } from '../deck/useDeckControls';
import { emptyCounts, type TriageItem } from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import { makeItem } from './triageFixtures';

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
  };
  return { queue, decide };
}

/** The deck's input layer, with none of its paint. */
function Deck({ queue, onClose }: { queue: UnifiedTriageQueue; onClose: () => void }) {
  useDeckControls(queue, onClose);
  return null;
}

/**
 * Stands in for `BacklogFocusDeck` / `ReviewFocusFlow` / `AthenaOrbLayer`:
 * a route-level surface that decides something and stays mounted underneath.
 */
function SurfaceUnderneath({ onKey }: { onKey: (key: string) => void }) {
  useAppKeyboard(
    (e) => {
      onKey(e.key);
      return false;
    },
    { priority: ROUTE_DECISION_PRIORITY },
  );
  return null;
}

/** Stands in for the command palette (90) / BaseModal (80) — above the deck. */
function SurfaceAbove({ onKey }: { onKey: (key: string) => void }) {
  useAppKeyboard(
    (e) => {
      onKey(e.key);
      return e.key === 'k';
    },
    { priority: 90 },
  );
  return null;
}

const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });

/** Every key that could act on a surface behind the deck. */
const DANGEROUS_KEYS: [string, Partial<KeyboardEventInit>][] = [
  ['ArrowLeft', {}], // deck: reject · review flow + backlog deck: reject
  ['ArrowRight', {}], // deck: accept · review flow + backlog deck: accept
  ['ArrowDown', {}], // review flow: retry
  ['a', {}], // backlog deck: reject — the deck does not bind it at all
  ['z', {}], // backlog deck: accept — likewise
  ['1', {}], // deck: branch · Athena's `;`-leader: answer a decision
  ['s', {}], // deck: skip · title-bar dock: open search in nav mode
  [';', {}], // nav mode toggle · Athena leader
  ['ArrowLeft', { shiftKey: true }], // deck bails on modifiers; the review flow never checked them
];

describe('the triage deck owns the keyboard while it is open', () => {
  let underneath: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    underneath = vi.fn();
  });

  it('lets NO keydown through to a surface mounted underneath it', () => {
    const { queue, decide } = makeQueue([makeItem('idea')]);
    render(
      <AppKeyboardProvider>
        <SurfaceUnderneath onKey={underneath} />
        <Deck queue={queue} onClose={vi.fn()} />
      </AppKeyboardProvider>,
    );

    for (const [key, init] of DANGEROUS_KEYS) press(key, init);

    expect(underneath).not.toHaveBeenCalled();
    // …and the deck itself did act, so this is not "nothing is listening".
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'reject' }));
  });

  it('claims Escape rather than letting it close something behind the deck', () => {
    const onClose = vi.fn();
    const { queue } = makeQueue([makeItem('review')]);
    render(
      <AppKeyboardProvider>
        <SurfaceUnderneath onKey={underneath} />
        <Deck queue={queue} onClose={onClose} />
      </AppKeyboardProvider>,
    );

    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(underneath).not.toHaveBeenCalled();
  });

  it('gives the route its keyboard back the moment the deck unmounts', () => {
    const { queue } = makeQueue([makeItem('idea')]);
    const { rerender } = render(
      <AppKeyboardProvider>
        <SurfaceUnderneath onKey={underneath} />
        <Deck queue={queue} onClose={vi.fn()} />
      </AppKeyboardProvider>,
    );

    press('ArrowLeft');
    expect(underneath).not.toHaveBeenCalled();

    rerender(
      <AppKeyboardProvider>
        <SurfaceUnderneath onKey={underneath} />
      </AppKeyboardProvider>,
    );

    for (const [key, init] of DANGEROUS_KEYS) press(key, init);
    expect(underneath.mock.calls.map(([k]) => k)).toEqual(
      DANGEROUS_KEYS.map(([key]) => key),
    );
  });

  it('still yields to the surfaces ABOVE it — a palette or modal on top of the deck', () => {
    const above = vi.fn();
    const onClose = vi.fn();
    const { queue, decide } = makeQueue([makeItem('practice')]);
    render(
      <AppKeyboardProvider>
        <Deck queue={queue} onClose={onClose} />
        <SurfaceAbove onKey={above} />
      </AppKeyboardProvider>,
    );

    // Consumed above the deck: the deck must not also decide on it.
    press('k');
    expect(above).toHaveBeenCalledWith('k');
    expect(decide).not.toHaveBeenCalled();

    // Seen above but not consumed: it falls through to the deck as normal.
    press('Escape');
    expect(above).toHaveBeenCalledWith('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

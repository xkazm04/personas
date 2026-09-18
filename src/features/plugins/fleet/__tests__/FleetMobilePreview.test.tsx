/**
 * Unit tests for FleetMobilePreview — specifically that the live fleet data on
 * the mock phone screen is REACHABLE by assistive technology.
 *
 * The phone frame is decoration; its screen is not. `aria-hidden` on the whole
 * screen subtree left a screen-reader user with the panel heading, the panel
 * description, and then silence — no session totals, no per-state counts, and
 * no list of which sessions are waiting on them.
 *
 * NOTE ON WHAT GATES WHAT: `getByText` does NOT respect `aria-hidden` — it was
 * verified passing identically with the attribute restored. The assertions that
 * actually fail on a re-introduction are the explicit attribute check and the
 * ROLE query, which is the one that reads the accessibility tree.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const SESSIONS: FleetSession[] = [
  {
    id: 's1',
    state: 'awaiting_input',
    projectLabel: 'repo-a',
    name: 'needs-me',
    lastActivityMs: Date.now() - 60_000,
  } as unknown as FleetSession,
  {
    id: 's2',
    state: 'running',
    projectLabel: 'repo-b',
    name: null,
    lastActivityMs: Date.now(),
  } as unknown as FleetSession,
  // `hibernated` is here on purpose: the preview used to keep a PRIVATE
  // six-entry state list that omitted `hibernated` and `finished`, so this
  // session was counted in the "N sessions" header and then rendered no chip.
  // The header and the chips disagreed by exactly the sessions the operator is
  // most likely to be confused by.
  {
    id: 's3',
    state: 'hibernated',
    projectLabel: 'repo-c',
    name: 'parked',
    lastActivityMs: Date.now() - 600_000,
  } as unknown as FleetSession,
];

// Read through a mutable slot rather than closing over SESSIONS directly, so a
// case can change what the fleet looks like between renders. It starts as
// SESSIONS and every case that changes it puts it back.
let CURRENT: FleetSession[] = SESSIONS;

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { fleetSessions: FleetSession[] }) => unknown) =>
    selector({ fleetSessions: CURRENT }),
}));

// Only the PTY write is stubbed; the rest of the fleet API keeps its real shape.
const writeInput = vi.fn();
vi.mock('@/api/fleet/fleet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeInput: (...a: unknown[]) => writeInput(...a),
}));

import { FleetMobilePreview } from '../FleetMobilePreview';

describe('FleetMobilePreview — live data is not hidden from assistive tech', () => {
  it('does not mark the phone screen aria-hidden', () => {
    render(<FleetMobilePreview />);
    const scr = screen.getByTestId('fleet-mobile-preview-screen');
    expect(scr.getAttribute('aria-hidden')).toBeNull();
    // …and nothing above it hides it either.
    expect(scr.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('exposes the needs-input entry through the accessibility tree', () => {
    render(<FleetMobilePreview />);
    // Role queries default to hidden:false, i.e. they see only what assistive
    // tech sees. An aria-hidden screen makes this list item unreachable and
    // this query throws — that is the behaviour under test.
    const items = screen.getAllByRole('listitem');
    expect(items.map((el) => el.textContent ?? '').join(' ')).toContain('needs-me');
  });

  it('renders the session total on the screen', () => {
    render(<FleetMobilePreview />);
    expect(screen.getByText(/3 sessions/i)).toBeTruthy();
  });

  it('renders a chip for every state present, so the chips add up to the header', () => {
    render(<FleetMobilePreview />);
    // One chip per non-zero state — including `hibernated`, which the private
    // list this component used to carry did not know about.
    expect(screen.getByText('Hibernated')).toBeTruthy();
    const chipCounts = screen
      .getAllByText(/^\d+$/)
      .map((el) => Number(el.textContent))
      .reduce((a, b) => a + b, 0);
    expect(chipCounts).toBe(3);
  });
});

/**
 * The one verb the preview carries.
 *
 * `FleetPairDevice` promises a paired phone allowlisted verdicts and
 * `FleetNeedsYouBanner` calls its inline reply "the core remote-approve gesture
 * the phone companion will mirror" — so a read-only frame could not rehearse
 * the single thing it exists to rehearse.
 *
 * Neither assertion below is "a reply was sent". What is pinned is the trailing
 * CARRIAGE RETURN, because that is what submits the line — without it the
 * session stays blocked with the operator's answer sitting unsent on its
 * prompt, which looks exactly like success — and that a FAILED send keeps the
 * typed text, since clearing it would cost the operator their answer on top of
 * the failure.
 */
describe('FleetMobilePreview — the remote-approve gesture', () => {
  beforeEach(() => {
    CURRENT = SESSIONS;
    writeInput.mockReset();
    writeInput.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    CURRENT = SESSIONS;
  });

  it('delivers one PTY line, carriage return included', async () => {
    render(<FleetMobilePreview />);

    fireEvent.click(screen.getByTestId('fleet-preview-reply-s1'));
    fireEvent.change(screen.getByTestId('fleet-preview-reply-input'), { target: { value: 'y' } });
    fireEvent.click(screen.getByTestId('fleet-preview-reply-send'));

    await waitFor(() => expect(writeInput).toHaveBeenCalledTimes(1));
    expect(writeInput.mock.calls[0]).toEqual(['s1', 'y' + String.fromCharCode(13)]);
    await waitFor(() => expect(screen.queryByTestId('fleet-preview-reply-input')).toBeNull());
  });

  it('offers the gesture only for sessions blocked on a human', () => {
    render(<FleetMobilePreview />);
    expect(screen.getByTestId('fleet-preview-reply-s1')).toBeTruthy();
    expect(screen.queryByTestId('fleet-preview-reply-s2')).toBeNull();
    expect(screen.queryByTestId('fleet-preview-reply-s3')).toBeNull();
  });

  it('cannot send an empty line', () => {
    render(<FleetMobilePreview />);
    fireEvent.click(screen.getByTestId('fleet-preview-reply-s1'));

    const send = screen.getByTestId('fleet-preview-reply-send');
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.click(send);
    expect(writeInput).not.toHaveBeenCalled();
  });

  it('keeps the typed answer when the send fails', async () => {
    writeInput.mockRejectedValue(new Error('session writer dropped'));
    render(<FleetMobilePreview />);

    fireEvent.click(screen.getByTestId('fleet-preview-reply-s1'));
    fireEvent.change(screen.getByTestId('fleet-preview-reply-input'), { target: { value: 'approve it' } });
    fireEvent.click(screen.getByTestId('fleet-preview-reply-send'));

    await waitFor(() => expect(writeInput).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId('fleet-preview-reply-input') as HTMLInputElement).value).toBe('approve it');
  });

  it('drops the open composer when its session stops waiting', async () => {
    const { rerender } = render(<FleetMobilePreview />);
    fireEvent.click(screen.getByTestId('fleet-preview-reply-s1'));
    expect(screen.getByTestId('fleet-preview-reply-input')).toBeTruthy();

    // Answering a prompt that is gone is the failure this guards.
    CURRENT = SESSIONS.map((x) => (x.id === 's1' ? ({ ...x, state: 'running' } as FleetSession) : x));
    rerender(<FleetMobilePreview />);

    await waitFor(() => expect(screen.queryByTestId('fleet-preview-reply-input')).toBeNull());
  });
});

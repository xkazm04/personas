/**
 * Unit tests for FleetBroadcastModal — focused on the P1.1 "Apply skill"
 * additions (the `initialText` seeding + `title` override) and the reused
 * PTY-write send path they ride on.
 *
 * The Zustand store and the fleet API are mocked at the module boundary so
 * the test stays in jsdom (no Tauri). `useTranslation` is the real proxy —
 * the title fallback and labels resolve from the English bundle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// Minimal stub — the modal only reads id / state / projectLabel / stateReason.
const SESSIONS: FleetSession[] = [
  {
    id: 's1',
    state: 'idle',
    projectLabel: 'repo-a',
    stateReason: null,
    name: null,
  } as unknown as FleetSession,
  // Hibernate FREES the process, so this row has no PTY writer to receive a
  // broadcast — it must never appear as a target.
  {
    id: 's-hib',
    state: 'hibernated',
    projectLabel: 'repo-hibernated',
    stateReason: null,
    name: null,
  } as unknown as FleetSession,
  {
    id: 's-dead',
    state: 'exited',
    projectLabel: 'repo-exited',
    stateReason: null,
    name: null,
  } as unknown as FleetSession,
];

// Selector-form store mock — the modal reads `s.fleetSessions` plus the
// `s.fleetRefresh` action it fires on open to sync the live session list.
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (
    selector: (s: { fleetSessions: FleetSession[]; fleetRefresh: () => Promise<void> }) => unknown,
  ) => selector({ fleetSessions: SESSIONS, fleetRefresh: async () => {} }),
}));

vi.mock('@/api/fleet/fleet', () => ({
  writeInput: vi.fn().mockResolvedValue(null),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetBroadcastModal } from '../FleetBroadcastModal';

describe('FleetBroadcastModal — Apply skill mode', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.writeInput).mockClear();
  });

  it('renders the title override and seeds the composer from initialText', async () => {
    render(
      <FleetBroadcastModal open onClose={() => {}} title="Apply skill to sessions" initialText="/code-review " />,
    );

    expect(screen.getByText('Apply skill to sessions')).toBeInTheDocument();
    // Seeding happens in an effect on open → wait for it to settle.
    await waitFor(() =>
      expect(screen.getByTestId('fleet-broadcast-text')).toHaveValue('/code-review '),
    );
  });

  it('writes the seeded slash command (with submit \\r) to the selected session', async () => {
    const user = userEvent.setup();
    render(
      <FleetBroadcastModal open onClose={() => {}} title="Apply skill to sessions" initialText="/code-review " />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('fleet-broadcast-text')).toHaveValue('/code-review '),
    );

    // Select the one targetable session by clicking its row, then send.
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() =>
      expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledWith('s1', '/code-review \r'),
    );
  });

  it('without initialText (plain broadcast) the composer starts empty', () => {
    render(<FleetBroadcastModal open onClose={() => {}} />);
    expect(screen.getByTestId('fleet-broadcast-text')).toHaveValue('');
  });
});

describe('FleetBroadcastModal — target list and failure handling', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.writeInput).mockClear().mockResolvedValue(undefined as never);
  });

  it('omits sessions with no PTY writer (exited AND hibernated) from the targets', () => {
    render(<FleetBroadcastModal open onClose={() => {}} />);

    expect(screen.getByText('repo-a')).toBeInTheDocument();
    expect(screen.queryByText('repo-exited')).not.toBeInTheDocument();
    // Hibernated rows look alive in every other list; here they are dead ends.
    expect(screen.queryByText('repo-hibernated')).not.toBeInTheDocument();
    // Derived from the rendered rows, not from a label: one target checkbox
    // plus the "Append Enter" toggle. Three sessions would give four.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('keeps the composed message and stays open when the broadcast reached nobody', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(fleetApi.writeInput).mockRejectedValue(new Error('session writer dropped'));

    render(<FleetBroadcastModal open onClose={onClose} />);
    const box = screen.getByTestId('fleet-broadcast-text');
    await user.type(box, 'expensive prompt');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalled());
    // Nothing landed — the operator keeps their text and their modal.
    expect(box).toHaveValue('expensive prompt');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears and closes when the broadcast did land', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<FleetBroadcastModal open onClose={onClose} />);
    await user.type(screen.getByTestId('fleet-broadcast-text'), 'hello fleet');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

/**
 * The composer is the one Fleet surface that commands the whole fleet at once,
 * and it shipped eight hardcoded English strings in a 14-language app. These
 * assertions read the rendered control names, so a regression to a raw literal
 * shows up as a changed string rather than as silence.
 */
describe('FleetBroadcastModal — localized chrome and result toasts', () => {
  beforeEach(() => {
    addToast.mockClear();
    vi.mocked(fleetApi.writeInput).mockClear().mockResolvedValue(undefined as never);
  });

  it('names its controls from the catalog, including the close button a screen reader reads', () => {
    render(<FleetBroadcastModal open onClose={() => {}} />);
    // aria-label="Close" was hardcoded, so a non-English screen-reader user got
    // an English control name on the fleet's most powerful surface.
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByText(/^Message$/)).toBeInTheDocument();
  });

  it('interpolates the singular send result rather than concatenating a count', async () => {
    const user = userEvent.setup();
    render(<FleetBroadcastModal open onClose={() => {}} />);
    await user.type(screen.getByTestId('fleet-broadcast-text'), 'hello');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    // One target → the _one variant. A single template with a bare count would
    // read "Sent to 1 sessions" in English and be ungrammatical in most locales.
    expect(addToast.mock.calls[0]![0]).toBe('Sent to 1 session');
    expect(addToast.mock.calls[0]![1]).toBe('success');
  });

  it('interpolates the total-failure result with the real target count', async () => {
    const user = userEvent.setup();
    vi.mocked(fleetApi.writeInput).mockRejectedValue(new Error('session writer dropped'));
    render(<FleetBroadcastModal open onClose={() => {}} />);
    await user.type(screen.getByTestId('fleet-broadcast-text'), 'hello');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(addToast.mock.calls[0]![0]).toContain('0 of 1');
    expect(addToast.mock.calls[0]![1]).toBe('error');
  });
});

/**
 * Naming the failures. An aggregate count ("3 of 7 — 4 failed") tells the
 * operator that something went wrong and nothing about where; with a fleet of
 * interactive agents that is the difference between a one-click retry and four
 * sessions silently sitting on the old instruction.
 */
describe('FleetBroadcastModal — which sessions missed it', () => {
  beforeEach(() => {
    addToast.mockClear();
    vi.mocked(fleetApi.writeInput).mockClear();
  });

  it('names the sessions that failed and narrows the selection to just them', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    // repo-a fails; the modal must say SO, by name.
    vi.mocked(fleetApi.writeInput).mockRejectedValue(new Error('session writer dropped'));

    render(<FleetBroadcastModal open onClose={onClose} />);
    await user.type(screen.getByTestId('fleet-broadcast-text'), 'ship it');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    const panel = await screen.findByTestId('fleet-broadcast-failed');
    expect(panel.textContent ?? '').toContain('repo-a');
    // Announced, not merely coloured.
    expect(panel).toHaveAttribute('role', 'status');

    // Still open, text intact, and the retry is armed on exactly the failures —
    // which is what makes pressing Send again safe rather than a double-submit.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('fleet-broadcast-text')).toHaveValue('ship it');
    expect(screen.getByTestId('fleet-broadcast-send')).not.toBeDisabled();
  });

  it('retries only the failed session and closes once it lands', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(fleetApi.writeInput).mockRejectedValueOnce(new Error('session writer dropped'));

    render(<FleetBroadcastModal open onClose={onClose} />);
    await user.type(screen.getByTestId('fleet-broadcast-text'), 'ship it');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));
    await screen.findByTestId('fleet-broadcast-failed');

    vi.mocked(fleetApi.writeInput).mockResolvedValue(undefined as never);
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Two attempts total, both to the one session that needed it.
    expect(vi.mocked(fleetApi.writeInput).mock.calls.map((c) => c[0])).toEqual(['s1', 's1']);
  });

  it('shows no failure panel when everything landed', async () => {
    const user = userEvent.setup();
    vi.mocked(fleetApi.writeInput).mockResolvedValue(undefined as never);

    render(<FleetBroadcastModal open onClose={() => {}} />);
    await user.type(screen.getByTestId('fleet-broadcast-text'), 'ship it');
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(screen.queryByTestId('fleet-broadcast-failed')).not.toBeInTheDocument();
  });
});

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

/**
 * Pins the exact payload FleetBroadcastModal hands to `writeInput` — the
 * frozen interface between the composer and the Rust write lane.
 *
 * Why this file exists separately from FleetBroadcastModal.test.tsx: the Rust
 * side (`fleet_write_input` → `write_text_line` → `keys::frame_paste`) now
 * decides between "type this line" and "paste this block" purely from the
 * SHAPE of this string — a trailing `\r`, and whether any newline survives
 * inside it. If the modal ever pre-normalises its textarea (strips or
 * collapses internal newlines, or sends `\n` instead of `\r` as the submit),
 * the multi-line broadcast silently reverts to arriving as several truncated
 * prompts and no Rust test can see it. So the contract is asserted here, at
 * the producer, in the terms the consumer reads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { FleetSession } from '@/lib/bindings/FleetSession';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const SESSIONS: FleetSession[] = [
  {
    id: 's1',
    state: 'idle',
    projectLabel: 'repo-a',
    stateReason: null,
    name: null,
  } as unknown as FleetSession,
];

const fleetRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (
    selector: (s: { fleetSessions: FleetSession[]; fleetRefresh: () => Promise<void> }) => unknown,
  ) => selector({ fleetSessions: SESSIONS, fleetRefresh }),
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

/** Compose `body` in the textarea, target the one live session, and send. */
async function broadcast(body: string): Promise<void> {
  const user = userEvent.setup();
  render(<FleetBroadcastModal open onClose={() => {}} />);
  const box = screen.getByTestId('fleet-broadcast-text');
  // `fireEvent.change`, not `user.type`: a typed newline in a textarea is a
  // keystroke the component could intercept, and what this test pins is the
  // payload for text that IS multi-line, however it got there.
  fireEvent.change(box, { target: { value: body } });
  await waitFor(() => expect(box).toHaveValue(body));
  await user.click(screen.getByText('repo-a'));
  await user.click(screen.getByTestId('fleet-broadcast-send'));
}

describe('FleetBroadcastModal — the payload contract with the PTY write lane', () => {
  beforeEach(() => {
    vi.mocked(fleetApi.writeInput).mockClear().mockResolvedValue(undefined as never);
  });

  it('sends a multi-line composition as ONE `${text}\r` payload, newlines intact', async () => {
    const body = 'line one\nline two\nline three';
    await broadcast(body);

    await waitFor(() => expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledTimes(1));
    const [sessionId, payload] = vi.mocked(fleetApi.writeInput).mock.calls[0] as [string, string];
    expect(sessionId).toBe('s1');
    // Exactly the frozen shape: the body verbatim + a single trailing CR.
    expect(payload).toBe(`${body}\r`);
    // The properties the Rust side actually branches on, asserted as such:
    // more than one char, ends in CR (→ routed to write_text_line), and the
    // internal newlines survive the trip (→ framed as a bracketed paste).
    expect(payload.length).toBeGreaterThan(1);
    expect(payload.endsWith('\r')).toBe(true);
    expect(payload.slice(0, -1)).toContain('\n');
    expect(payload.split('\n')).toHaveLength(3);
  });

  it('sends a single-line composition with no internal newline at all', async () => {
    await broadcast('/compact');

    await waitFor(() => expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(fleetApi.writeInput).mock.calls[0] as [string, string];
    // The unframed lane: Rust must write these bytes through untouched.
    expect(payload).toBe('/compact\r');
    expect(payload.slice(0, -1)).not.toContain('\n');
  });

  it('does not append the submit CR when "append Enter" is off', async () => {
    const user = userEvent.setup();
    render(<FleetBroadcastModal open onClose={() => {}} />);
    const box = screen.getByTestId('fleet-broadcast-text');
    fireEvent.change(box, { target: { value: 'draft\nonly' } });
    await waitFor(() => expect(box).toHaveValue('draft\nonly'));
    // The "Append Enter" toggle sits ABOVE the target list in the DOM, so it
    // is the first checkbox; it starts checked.
    const [appendEnter] = screen.getAllByRole('checkbox');
    expect(appendEnter).toBeChecked();
    await user.click(appendEnter);
    await user.click(screen.getByText('repo-a'));
    await user.click(screen.getByTestId('fleet-broadcast-send'));

    await waitFor(() => expect(vi.mocked(fleetApi.writeInput)).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(fleetApi.writeInput).mock.calls[0] as [string, string];
    expect(payload).toBe('draft\nonly');
    expect(payload.endsWith('\r')).toBe(false);
  });
});

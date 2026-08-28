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
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
];

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { fleetSessions: FleetSession[] }) => unknown) =>
    selector({ fleetSessions: SESSIONS }),
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
    expect(screen.getByText(/2 sessions/i)).toBeTruthy();
  });
});

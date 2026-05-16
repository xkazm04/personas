/**
 * Unit tests for FleetStatusBadge.
 *
 * The badge renders six distinct state pills + a fallback for unknown
 * states. Each state has its own label, icon, and pulse/spin behavior.
 * The reason prop wires into the title attribute (used as tooltip).
 *
 * Pure presentational component — no store, no invoke, no events —
 * trivially testable in isolation.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

import { FleetStatusBadge, STATE_PRIORITY } from '../FleetStatusBadge';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('FleetStatusBadge', () => {
  it('renders the six known states with their canonical labels', () => {
    const cases: Array<{ state: FleetSessionState; label: string }> = [
      { state: 'spawning', label: 'Spawning' },
      { state: 'running', label: 'Running' },
      { state: 'awaiting_input', label: 'Waiting for you' },
      { state: 'idle', label: 'Idle' },
      { state: 'stale', label: 'Stale' },
      { state: 'exited', label: 'Exited' },
    ];
    for (const c of cases) {
      const { unmount } = render(<FleetStatusBadge state={c.state} />);
      expect(screen.getByText(c.label)).toBeInTheDocument();
      unmount();
    }
  });

  it('uses the supplied reason as the tooltip when present', () => {
    render(<FleetStatusBadge state="awaiting_input" reason="Permission requested" />);
    // The reason flows into title via the role-less span — find by its visible label.
    const badge = screen.getByText('Waiting for you').closest('span');
    expect(badge).toHaveAttribute('title', 'Permission requested');
  });

  it('falls back to the state label as tooltip when no reason given', () => {
    render(<FleetStatusBadge state="running" />);
    const badge = screen.getByText('Running').closest('span');
    expect(badge).toHaveAttribute('title', 'Running');
  });

  it('renders a fallback pill for unknown state values without crashing', () => {
    // Pass a deliberate unknown — the component must not throw and must
    // render *something* so users see "this row is in a weird state" not
    // "the entire page errored".
    render(<FleetStatusBadge state={'galactic' as unknown as FleetSessionState} />);
    expect(screen.getByText('galactic')).toBeInTheDocument();
  });

  it('STATE_PRIORITY ranks awaiting_input first', () => {
    // The grid sort relies on awaiting_input being highest priority so
    // "sessions that need attention" appear at the top of every project
    // group. Make that contract explicit in a test.
    const states: FleetSessionState[] = ['awaiting_input', 'running', 'spawning', 'idle', 'stale', 'exited'];
    const sorted = [...states].sort((a, b) => (STATE_PRIORITY[b] ?? 0) - (STATE_PRIORITY[a] ?? 0));
    expect(sorted[0]).toBe('awaiting_input');
    expect(sorted[sorted.length - 1]).toBe('exited');
  });

  it('exited state ranks below stale', () => {
    // Stale → still tracked, recoverable. Exited → terminal. Both are
    // low-priority but Exited should sink even lower so the user sees
    // still-alive sessions before dead ones.
    expect(STATE_PRIORITY.stale).toBeGreaterThan(STATE_PRIORITY.exited);
  });
});

/**
 * Unit tests for FleetStatusDots — the two-axis (console + business)
 * indicator used in the compact session rows. Pure presentation, no
 * store or invoke surface.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

import { FleetStatusDots, deriveAxes } from '../FleetStatusDots';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

describe('deriveAxes', () => {
  it('maps the six lifecycle states to (console, business) axes', () => {
    expect(deriveAxes('spawning'))      .toEqual({ console: 'spawning', business: 'none' });
    expect(deriveAxes('running'))       .toEqual({ console: 'alive',    business: 'working' });
    expect(deriveAxes('awaiting_input')).toEqual({ console: 'alive',    business: 'awaiting_input' });
    expect(deriveAxes('idle'))          .toEqual({ console: 'alive',    business: 'idle' });
    expect(deriveAxes('stale'))         .toEqual({ console: 'alive',    business: 'stale' });
    expect(deriveAxes('exited'))        .toEqual({ console: 'exited',   business: 'none' });
  });
});

describe('FleetStatusDots', () => {
  it('renders both dots for alive states', () => {
    render(<FleetStatusDots state="running" />);
    const wrapper = screen.getByTestId('fleet-dots-running');
    // Two child <span> wrappers — one per dot.
    expect(wrapper.querySelectorAll(':scope > span').length).toBe(2);
  });

  it('renders only the console dot for spawning (no business axis yet)', () => {
    render(<FleetStatusDots state="spawning" />);
    const wrapper = screen.getByTestId('fleet-dots-spawning');
    expect(wrapper.querySelectorAll(':scope > span').length).toBe(1);
  });

  it('renders only the console dot for exited (business axis n/a)', () => {
    render(<FleetStatusDots state="exited" />);
    const wrapper = screen.getByTestId('fleet-dots-exited');
    expect(wrapper.querySelectorAll(':scope > span').length).toBe(1);
  });

  it('threads the reason prop into the console dot title for tooltip', () => {
    render(<FleetStatusDots state="awaiting_input" reason="Notification: permission" />);
    const wrapper = screen.getByTestId('fleet-dots-awaiting_input');
    const consoleDot = wrapper.querySelector(':scope > span');
    expect(consoleDot?.getAttribute('title') ?? '').toContain('Notification: permission');
  });

  it('falls back to the state label when no reason given', () => {
    render(<FleetStatusDots state="idle" />);
    const wrapper = screen.getByTestId('fleet-dots-idle');
    const consoleDot = wrapper.querySelector(':scope > span');
    // For an idle session the console is alive, so we expect "Process alive".
    expect(consoleDot?.getAttribute('title')).toBe('Process alive');
  });

  it('handles the full lifecycle without throwing', () => {
    const states: FleetSessionState[] = ['spawning', 'running', 'awaiting_input', 'idle', 'stale', 'exited'];
    for (const s of states) {
      const { unmount } = render(<FleetStatusDots state={s} />);
      expect(screen.getByTestId(`fleet-dots-${s}`)).toBeInTheDocument();
      unmount();
    }
  });
});

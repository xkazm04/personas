/**
 * The schedule plate is the "don't forget" signal for the operator's scheduled tasks: absent
 * until something is scheduled, one line per task with its next start, and a switch that
 * flips exactly the task it sits on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { ScheduledTaskView } from '@/lib/bindings/ScheduledTaskView';

const list = vi.fn<() => Promise<ScheduledTaskView[]>>();
const setEnabled = vi.fn<(name: string, enabled: boolean) => Promise<ScheduledTaskView[]>>();
vi.mock('@/api/fleet/schedules', () => ({
  fleetScheduledTasks: () => list(),
  setFleetScheduledTaskEnabled: (name: string, enabled: boolean) => setEnabled(name, enabled),
}));

import { SchedulePlate } from './SchedulePlate';

const night: ScheduledTaskView = {
  name: 'CuratorNight', title: 'Curator night', window: '23:00-07:00', enabled: true, state: 'Ready',
  nextRunMs: Date.UTC(2026, 9, 13, 21, 0), lastRunMs: null, lastResult: null,
};

describe('SchedulePlate', () => {
  beforeEach(() => {
    list.mockReset();
    setEnabled.mockReset();
  });

  it('renders nothing while nothing is scheduled', async () => {
    list.mockResolvedValue([]);
    const { container } = render(<SchedulePlate />);
    await act(async () => {});
    expect(container.querySelector('[data-testid="entry-e-schedules"]')).toBeNull();
  });

  it('draws one line per task and flips the task the switch sits on', async () => {
    list.mockResolvedValue([night, { ...night, name: 'Other', title: 'Other job', enabled: false, state: 'Disabled', nextRunMs: null }]);
    setEnabled.mockResolvedValue([{ ...night, enabled: false, state: 'Disabled', nextRunMs: null }]);
    render(<SchedulePlate />);
    await act(async () => {});
    const lines = screen.getAllByTestId('entry-e-schedule-line');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.textContent).toContain('Curator night');
    expect(lines[0]?.getAttribute('data-enabled')).toBe('true');
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('entry-e-schedule-toggle')[0]!);
    });
    expect(setEnabled).toHaveBeenCalledWith('CuratorNight', false);
  });

  it('draws each item as two rows: the name alone first, then the next start and the switch', async () => {
    list.mockResolvedValue([
      night,
      { ...night, name: 'Run', title: 'Nightly vault backup', state: 'Running' },
      { ...night, name: 'Off', title: 'Weekly digest', enabled: false, state: 'Disabled', nextRunMs: null },
    ]);
    render(<SchedulePlate />);
    await act(async () => {});
    const [first, running, off] = screen.getAllByTestId('entry-e-schedule-line');
    // Row 1 is the name and nothing else; row 2 carries the time and the toggle.
    const name = first!.querySelector('[data-testid="entry-e-schedule-name"]')!;
    expect(name.textContent).toBe('Curator night');
    const when = first!.querySelector('[data-testid="entry-e-schedule-when"]')!;
    expect(when.textContent).toMatch(/\d{2}:\d{2}/);
    expect(when.textContent).not.toMatch(/AM|PM/);
    expect(when.getAttribute('aria-label')).toContain(when.textContent!);
    expect(when.parentElement!.querySelector('[data-testid="entry-e-schedule-toggle"]')).toBeTruthy();
    expect(name.parentElement!.querySelector('[data-testid="entry-e-schedule-toggle"]')).toBeNull();
    expect(running!.querySelector('[data-testid="entry-e-schedule-when"]')!.textContent).toBe('running now');
    expect(off!.querySelector('[data-testid="entry-e-schedule-when"]')!.textContent).toBe('off');
    expect(off!.getAttribute('data-enabled')).toBeNull();
  });
});

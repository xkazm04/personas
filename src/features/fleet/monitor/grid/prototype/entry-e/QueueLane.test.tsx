/**
 * A Queue lane speaks the bay's annunciator grammar: its lamp lights only when
 * something inside works or needs the operator, with the worst state winning,
 * and a lane of queued or cleanly parked sessions stays a dark plate.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { laneLamp, QueueLane } from './QueueLane';

const session = (id: string, state: FleetSession['state'], exitCode: number | null = null): FleetSession =>
  ({ id, state, exitCode }) as unknown as FleetSession; // laneLamp reads only state and exitCode

describe('laneLamp', () => {
  it('is dark for an empty lane, a queue and clean exits', () => {
    expect(laneLamp([]).lit).toBe(false);
    expect(laneLamp([session('a', 'queued'), session('b', 'queued')]).lit).toBe(false);
    expect(laneLamp([session('a', 'finished'), session('b', 'exited', 0), session('c', 'hibernated')]).lit).toBe(false);
  });

  it('lights run while something works', () => {
    expect(laneLamp([session('a', 'idle'), session('b', 'running')])).toEqual({ tone: 'run', lit: true });
  });

  it('lets the worst state win: an input wait over work, a failed exit over everything', () => {
    expect(laneLamp([session('a', 'running'), session('b', 'awaiting_input')])).toEqual({ tone: 'warn', lit: true });
    expect(laneLamp([session('a', 'awaiting_input'), session('b', 'exited', 1), session('c', 'running')])).toEqual({ tone: 'err', lit: true });
  });
});

describe('QueueLane', () => {
  it('keeps its testid, counts its sessions and lights its nameplate lamp', () => {
    const { container } = render(
      <QueueLane title="Running" sessions={[session('a', 'running')]} empty="none" testId="fleet-queue-lane-running">
        <div>line</div>
      </QueueLane>,
    );
    const lane = screen.getByTestId('fleet-queue-lane-running');
    expect(lane.className).toContain('ae-plate');
    expect(lane.textContent).toContain('1');
    expect(container.querySelector('.ae-lamp.is-lit')).not.toBeNull();
  });

  it('shows the empty well and a dark lamp when it holds nothing', () => {
    const { container } = render(<QueueLane title="Queued" sessions={[]} empty="Nothing queued" testId="fleet-queue-lane-queued" />);
    expect(screen.getByText('Nothing queued').className).toContain('ae-well');
    expect(container.querySelector('.ae-lamp.is-lit')).toBeNull();
  });
});

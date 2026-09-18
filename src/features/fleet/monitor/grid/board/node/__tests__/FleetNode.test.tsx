// FleetNode — the handpicked meta row, and NOTHING else.
//
// The node's contract is as much what it leaves out as what it shows: every
// variant × kind has a fixed set of fields, and a field that leaks from one
// variant into another (an origin chip on a persona, a rank on a live row)
// is the drift this file exists to catch. So every case asserts presence AND
// absence, by test id, against the table in `FleetNode.tsx`'s header.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../../monitorModel';
import { FleetNode, liveMeterFill, queuedMeterFill } from '../FleetNode';
import { NodeContext, type NodeContextValue, type NodeVariant } from '../nodeVariant';
import type { QueueItem } from '../../queue/useQueueModel';

const NOW = Date.now();
const LONG = 'Chasing a flaky migration test on the cold-start path of the installer';

function card(o: Partial<PersonaCardModel> = {}): PersonaCardModel {
  return {
    personaId: 'p', personaName: 'Release Scribe', personaIcon: null, personaColor: null, enabled: true,
    reviews: [], reviewCounts: { critical: 0, warning: 0, info: 0 }, topReviewSeverity: null,
    messages: [], processes: [],
    running: 0, queued: 0, inputRequired: 0, draftReady: 0, runningSince: null,
    execState: 'idle', attentionCount: 0,
    healthStatus: null, recentStatuses: [], successRate: null, runsToday: 0, totalRecent: 0,
    liveCostUsd: 0, liveToolCalls: 0,
    ...o,
  };
}

// A fixture, not a wire payload: only the fields the node reads are real, and
// the cast names that — the binding's other twenty fields are never touched.
function session(o: Partial<FleetSession> = {}): FleetSession {
  return {
    id: 's1', title: LONG, name: null, projectLabel: 'pumper', cwd: '/x', state: 'running',
    createdAtMs: BigInt(NOW - 5 * 60_000), origin: 'athena',
    ...o,
  } as unknown as FleetSession;
}

function queued(o: Partial<QueueItem> = {}): QueueItem {
  const s = session({ id: 'q1', state: 'queued', origin: 'autopilot', ...(o.session ?? {}) });
  return {
    sessionId: s.id, session: s, rank: 3, origin: 'autopilot', personaId: null, goalId: null,
    projectLabel: s.projectLabel, locked: false, estimatedStartMs: NOW + 20 * 60_000, notBeforeMs: null,
    ...o,
  };
}

function wrap(variant: NodeVariant, ui: ReactNode, ctx: Partial<NodeContextValue> = {}) {
  const value: NodeContextValue = { variant, meanDurationMs: 10 * 60_000, queueLength: 30, ...ctx };
  return render(<NodeContext.Provider value={value}>{ui}</NodeContext.Provider>);
}

const has = (id: string) => screen.queryByTestId(id) !== null;
const meta = () => screen.getByTestId('fleet-node-meta');

describe('FleetNode — title row', () => {
  it('renders the FULL title in the title row (CSS truncates; the text is intact for the tooltip)', () => {
    wrap('ledger', <FleetNode kind="session" session={session()} ariaLabel={LONG} tooltip={LONG} />);
    expect(screen.getByTestId('fleet-node-title').textContent).toBe(LONG);
  });

  it('is a button only when it activates something', () => {
    wrap('ledger', <FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" bodyTestId="body" />);
    expect(screen.getByTestId('body').tagName).toBe('SPAN');
    wrap('ledger', <FleetNode kind="session" session={session({ id: 's2' })} ariaLabel="y" tooltip="y" bodyTestId="body2" onActivate={() => {}} />);
    expect(screen.getByTestId('body2').tagName).toBe('BUTTON');
  });
});

describe('FleetNode — session, running', () => {
  it('ledger: state · elapsed · origin · project, no rank / ETA / meter', () => {
    wrap('ledger', <FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-state').textContent).toContain('Working');
    expect(screen.getByTestId('fleet-queue-origin').textContent).toBe('Athena');
    expect(screen.getByTestId('fleet-node-project').textContent).toBe('pumper');
    expect(meta().textContent).toMatch(/5\s?min/);
    expect(has('fleet-queue-rank')).toBe(false);
    expect(has('fleet-node-eta')).toBe(false);
    expect(has('fleet-node-meter')).toBe(false);
  });

  it('badge: state + project badges, no rank / origin / elapsed', () => {
    wrap('badge', <FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    expect(has('fleet-node-state')).toBe(true);
    expect(has('fleet-node-project')).toBe(true);
    expect(has('fleet-queue-rank')).toBe(false);
    expect(has('fleet-queue-origin')).toBe(false);
    expect(meta().textContent).not.toMatch(/min/);
  });

  it('meter: elapsed ÷ mean, one elapsed stat, nothing else', () => {
    wrap('meter', <FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    const m = screen.getByTestId('fleet-node-meter');
    expect(m.getAttribute('data-fill')).toBe('0.50');
    expect(m.textContent).toMatch(/5\s?min/);
    expect(has('fleet-node-state')).toBe(false);
    expect(has('fleet-queue-origin')).toBe(false);
    expect(has('fleet-node-project')).toBe(false);
  });
});

describe('FleetNode — session, queued', () => {
  it('ledger: rank · ETA · origin, no state / project / meter', () => {
    const q = queued();
    wrap('ledger', <FleetNode kind="session" session={q.session} queue={q} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-queue-rank').textContent).toBe('#3');
    expect(screen.getByTestId('fleet-node-eta').textContent).toMatch(/^ETA /);
    expect(screen.getByTestId('fleet-queue-origin').textContent).toBe('Autopilot');
    expect(has('fleet-node-state')).toBe(false);
    expect(has('fleet-node-project')).toBe(false);
    expect(has('fleet-node-meter')).toBe(false);
  });

  it('ledger: says "No estimate" when the door has no history', () => {
    const q = queued({ estimatedStartMs: null });
    wrap('ledger', <FleetNode kind="session" session={q.session} queue={q} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-eta').textContent).toBe('No estimate');
  });

  it('badge: state · #rank · project, no ETA / origin', () => {
    const q = queued();
    wrap('badge', <FleetNode kind="session" session={q.session} queue={q} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-state').textContent).toBe('Queued');
    expect(screen.getByTestId('fleet-queue-rank').textContent).toBe('#3');
    expect(has('fleet-node-project')).toBe(true);
    expect(has('fleet-node-eta')).toBe(false);
    expect(has('fleet-queue-origin')).toBe(false);
  });

  it('meter: rank ÷ length inverted, one ETA stat, no rank text / origin', () => {
    const q = queued({ rank: 1 });
    wrap('meter', <FleetNode kind="session" session={q.session} queue={q} ariaLabel="x" tooltip="x" />, { queueLength: 9 });
    expect(screen.getByTestId('fleet-node-meter').getAttribute('data-fill')).toBe('0.90');
    expect(has('fleet-node-eta')).toBe(true);
    expect(has('fleet-queue-rank')).toBe(false);
    expect(has('fleet-queue-origin')).toBe(false);
  });

  it('shows the gate marker only while notBefore is in the future', () => {
    const gated = queued({ notBeforeMs: NOW + 60_000 });
    wrap('ledger', <FleetNode kind="session" session={gated.session} queue={gated} ariaLabel="x" tooltip="x" />);
    expect(has('fleet-node-gate')).toBe(true);
    const past = queued({ notBeforeMs: NOW - 60_000 });
    render(<NodeContext.Provider value={{ variant: 'ledger', meanDurationMs: null, queueLength: 1 }}>
      <FleetNode kind="session" session={past.session} queue={past} ariaLabel="y" tooltip="y" testId="past" />
    </NodeContext.Provider>);
    expect(screen.getByTestId('past').querySelector('[data-testid="fleet-node-gate"]')).toBeNull();
  });
});

describe('FleetNode — persona', () => {
  const c = card({ personaName: 'T: Release Scribe of the long-running release train', queued: 2, running: 1, runningSince: NOW - 3 * 60_000, execState: 'running' });

  it('ledger: state · team · unseen chat · queued count, no origin / project / meter', () => {
    wrap('ledger', <FleetNode kind="persona" card={c} teamName="pumper" unseenChat={4} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-title').textContent).toBe('Release Scribe of the long-running release train');
    expect(screen.getByTestId('fleet-node-state').textContent).toContain('Running');
    expect(screen.getByTestId('fleet-node-team').textContent).toBe('pumper');
    expect(screen.getByTestId('fleet-grid-chat-unseen').textContent).toBe('4');
    expect(screen.getByTestId('fleet-node-queued').textContent).toBe('2 queued');
    expect(has('fleet-queue-origin')).toBe(false);
    expect(has('fleet-node-project')).toBe(false);
    expect(has('fleet-node-meter')).toBe(false);
  });

  it('ledger: a tray persona has no team and shows none', () => {
    wrap('ledger', <FleetNode kind="persona" card={card()} teamName={null} ariaLabel="x" tooltip="x" />);
    expect(has('fleet-node-team')).toBe(false);
    expect(has('fleet-node-queued')).toBe(false);
    expect(has('fleet-grid-chat-unseen')).toBe(false);
  });

  it('badge: state, chat and queued pills, no team', () => {
    wrap('badge', <FleetNode kind="persona" card={c} teamName="pumper" unseenChat={1} ariaLabel="x" tooltip="x" />);
    expect(has('fleet-node-state')).toBe(true);
    expect(has('fleet-grid-chat-unseen')).toBe(true);
    expect(has('fleet-node-queued')).toBe(true);
    expect(has('fleet-node-team')).toBe(false);
  });

  it('meter: elapsed ÷ mean with the elapsed stat; the chat mark keeps its title-row seat', () => {
    wrap('meter', <FleetNode kind="persona" card={c} teamName="pumper" unseenChat={1} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-meter').getAttribute('data-fill')).toBe('0.30');
    expect(has('fleet-grid-chat-unseen')).toBe(true);
    expect(has('fleet-node-team')).toBe(false);
    expect(has('fleet-node-queued')).toBe(false);
  });

  it('meter: an idle persona has an empty meter and its state as the stat', () => {
    wrap('meter', <FleetNode kind="persona" card={card()} teamName={null} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-meter').getAttribute('data-fill')).toBe('0.00');
    expect(screen.getByTestId('fleet-node-state').textContent).toBe('Idle');
  });
});

describe('meter arithmetic', () => {
  it('caps a live row at full and empties it without a mean', () => {
    expect(liveMeterFill(5, 10)).toBe(0.5);
    expect(liveMeterFill(50, 10)).toBe(1);
    expect(liveMeterFill(5, null)).toBe(0);
    expect(liveMeterFill(5, 0)).toBe(0);
  });

  it('fills the head of the queue nearly full and the tail nearly empty', () => {
    expect(queuedMeterFill(1, 9)).toBe(0.9);
    expect(queuedMeterFill(9, 9)).toBeCloseTo(0.1);
    expect(queuedMeterFill(null, 9)).toBe(0);
    expect(queuedMeterFill(1, 0)).toBe(0);
  });
});

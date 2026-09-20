// FleetNode — a title row that is the title, a symbol row that is the map.
//
// The node's contract is as much what it leaves out as what it shows. The
// first two-row node shared its title row with a glyph and a chip and hung
// side columns beside the body; the operator rejected it because the title
// was still truncated and the three styles looked the same. Tinted was then
// picked and the other two deleted. So this file asserts, per kind × state:
//   • the title row holds ONE element — the title — and no sibling;
//   • the symbol row holds EXACTLY the symbols `nodeSymbols` orders, by
//     `data-symbol`, presence AND absence;
//   • the one treatment: hue wash, solid symbol circles, a labelled bottom bar.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../../monitorModel';
import { FleetNode, liveMeterFill, queuedMeterFill } from '../FleetNode';
import { NodeContext, type NodeContextValue } from '../nodeContext';
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

function wrap(ui: ReactNode, ctx: Partial<NodeContextValue> = {}) {
  const value: NodeContextValue = { meanDurationMs: 10 * 60_000, queueLength: 30, ...ctx };
  return render(<NodeContext.Provider value={value}>{ui}</NodeContext.Provider>);
}

/** The symbol row's ids, left → right. */
const symbols = (root: ParentNode = document) =>
  [...root.querySelectorAll('[data-testid="fleet-node-symbols"] [data-symbol]')].map((e) => (e as HTMLElement).dataset.symbol);
const has = (id: string) => screen.queryByTestId(id) !== null;

describe('FleetNode — the title row', () => {
  it('holds the title and NOTHING else — no glyph, no chip, no control beside it', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel={LONG} tooltip={LONG} />);
    const row = screen.getByTestId('fleet-node-title-row');
    const title = screen.getByTestId('fleet-node-title');
    expect(row.textContent).toBe(LONG);
    // The only thing between the row and the title is the Tooltip's box-less
    // trigger wrapper; the title has no siblings at any level.
    expect(row.children).toHaveLength(1);
    expect(title.parentElement!.children).toHaveLength(1);
    expect(title.children).toHaveLength(0);
    expect(row.querySelectorAll('svg, button, [data-symbol]')).toHaveLength(0);
  });

  it('renders the FULL title (CSS truncates; the text is intact for the tooltip)', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel={LONG} tooltip={LONG} />);
    expect(screen.getByTestId('fleet-node-title').textContent).toBe(LONG);
    expect(screen.getByTestId('fleet-node-title').className).toContain('truncate');
  });

  it('is a button only when it activates something, and the symbol row sits inside the body either way', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" bodyTestId="body" />);
    expect(screen.getByTestId('body').tagName).toBe('SPAN');
    expect(screen.getByTestId('body').querySelector('[data-testid="fleet-node-symbols"]')).not.toBeNull();
    wrap(<FleetNode kind="session" session={session({ id: 's2' })} ariaLabel="y" tooltip="y" bodyTestId="body2" onActivate={() => {}} />);
    expect(screen.getByTestId('body2').tagName).toBe('BUTTON');
    expect(screen.getByTestId('body2').getAttribute('aria-label')).toBe('y');
  });
});

describe('FleetNode — the symbol row, session', () => {
  it('running: state · origin · project in the row, elapsed on the bottom bar — no rank, no gate, no persona symbol', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    expect(symbols()).toEqual(['state', 'origin', 'project']);
    expect(screen.getByTestId('fleet-node-state').getAttribute('aria-label')).toBe('Working');
    expect(screen.getByTestId('fleet-queue-origin').getAttribute('aria-label')).toBe('Dispatched by Athena');
    expect(screen.getByTestId('fleet-queue-origin').dataset.origin).toBe('athena');
    expect(screen.getByTestId('fleet-node-elapsed').dataset.fill).toBe('0.50');
    expect(screen.getByTestId('fleet-node-project').getAttribute('aria-label')).toBe('Project pumper');
    expect(screen.getByTestId('fleet-node-project').textContent).toBe('P');
    expect(has('fleet-queue-rank')).toBe(false);
    expect(has('fleet-node-gate')).toBe(false);
    expect(has('fleet-node-team')).toBe(false);
    expect(has('fleet-grid-chat-unseen')).toBe(false);
  });

  it('running with no mean duration yet: no elapsed bar', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />, { meanDurationMs: null });
    expect(symbols()).toEqual(['state', 'origin', 'project']);
  });

  it('queued: state · origin · rank · gate · project, the ETA on the bottom bar, the rank as the one numeral', () => {
    const q = queued({ notBeforeMs: NOW + 60_000 });
    wrap(<FleetNode kind="session" session={q.session} queue={q} ariaLabel="x" tooltip="x" />);
    expect(symbols()).toEqual(['state', 'origin', 'rank', 'gate', 'project']);
    expect(screen.getByTestId('fleet-node-state').getAttribute('aria-label')).toBe('Queued');
    expect(screen.getByTestId('fleet-queue-rank').textContent).toBe('3');
    expect(screen.getByTestId('fleet-queue-rank').getAttribute('aria-label')).toBe('Queue position 3');
    expect(screen.getByTestId('fleet-queue-origin').dataset.origin).toBe('autopilot');
    expect(screen.getByTestId('fleet-node-gate').getAttribute('aria-label')).toMatch(/^Not before /);
    expect(screen.getByTestId('fleet-node-elapsed').dataset.fill).toBe('0.90');
    expect(screen.getByTestId('fleet-node-elapsed').getAttribute('aria-label')).toMatch(/^Estimated start /);
  });

  it('queued: the gate goes once notBefore has passed; "No estimate" names an empty door', () => {
    const q = queued({ notBeforeMs: NOW - 60_000, estimatedStartMs: null });
    wrap(<FleetNode kind="session" session={q.session} queue={q} ariaLabel="x" tooltip="x" />);
    expect(symbols()).toEqual(['state', 'origin', 'rank', 'project']);
    expect(screen.getByTestId('fleet-node-elapsed').getAttribute('aria-label')).toBe('No estimate');
  });

  it('paints every lifecycle state as a symbol and never as a word', () => {
    const states = ['awaiting_input', 'idle', 'stale', 'finished', 'hibernated', 'exited', 'spawning'] as const;
    for (const state of states) {
      const { unmount } = wrap(<FleetNode kind="session" session={session({ id: state, state })} ariaLabel="x" tooltip="x" />);
      expect(symbols()).toEqual(['state', 'origin', 'project']);
      const row = screen.getByTestId('fleet-node-symbols');
      expect(row.textContent).toBe('P'); // the project swatch's initial is the only glyph text in the row
      expect(screen.getByTestId('fleet-node-state').dataset.state).toBe(state);
      unmount();
    }
  });

  it('reads the origin from the queue first and the session second, defaulting to manual', () => {
    wrap(<FleetNode kind="session" session={session({ origin: null })} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-queue-origin').dataset.origin).toBe('manual');
    expect(screen.getByTestId('fleet-queue-origin').getAttribute('aria-label')).toBe('Dispatched by Manual');
  });
});

describe('FleetNode — the symbol row, persona', () => {
  const c = card({
    personaName: 'T: Release Scribe of the long-running release train',
    queued: 2, running: 1, runningSince: NOW - 3 * 60_000, execState: 'running', inputRequired: 1,
  });

  it('state · team · operation · unseen · queued — no origin, no project, no rank', () => {
    wrap(<FleetNode kind="persona" card={c} teamName="pumper" unseenChat={4} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-title').textContent).toBe('Release Scribe of the long-running release train');
    expect(symbols()).toEqual(['state', 'team', 'operation', 'unseen', 'queued']);
    expect(screen.getByTestId('fleet-node-state').getAttribute('aria-label')).toBe('Running');
    expect(screen.getByTestId('fleet-node-team').getAttribute('aria-label')).toBe('Team pumper');
    expect(screen.getByTestId('fleet-grid-badge').dataset.action).toBe('input');
    expect(screen.getByTestId('fleet-grid-badge').getAttribute('aria-label')).toBe('1 awaiting your input');
    expect(screen.getByTestId('fleet-grid-chat-unseen').textContent).toBe('4');
    expect(screen.getByTestId('fleet-node-queued').textContent).toBe('2');
    expect(has('fleet-queue-origin')).toBe(false);
    expect(has('fleet-node-project')).toBe(false);
    expect(has('fleet-queue-rank')).toBe(false);
    expect(has('fleet-node-elapsed')).toBe(false);
  });

  it('a resting tray persona shows its state alone', () => {
    wrap(<FleetNode kind="persona" card={card()} teamName={null} ariaLabel="x" tooltip="x" />);
    expect(symbols()).toEqual(['state']);
    expect(screen.getByTestId('fleet-node-state').getAttribute('aria-label')).toBe('Idle');
    expect(has('fleet-node-team')).toBe(false);
    expect(has('fleet-node-queued')).toBe(false);
    expect(has('fleet-grid-chat-unseen')).toBe(false);
    expect(has('fleet-grid-badge')).toBe(false);
  });

  it('a switched-off persona carries the off symbol after its state', () => {
    wrap(<FleetNode kind="persona" card={card()} teamName="pumper" off ariaLabel="x" tooltip="x" />);
    expect(symbols()).toEqual(['state', 'off', 'team']);
    expect(screen.getByTestId('fleet-grid-disabled')).not.toBeNull();
  });

  it('shows attention and failed as the warning triangle, in their own hue', () => {
    wrap(<FleetNode kind="persona" card={card({ execState: 'failed' })} teamName={null} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-state').dataset.state).toBe('failed');
    expect(screen.getByTestId('fleet-node-state').className).toContain('text-background');
    expect(screen.getByTestId('fleet-node-state').className).toContain('bg-red-400');
    expect(screen.getByTestId('fleet-node-state').querySelector('svg')).not.toBeNull();
  });
});

describe('FleetNode — the treatment', () => {
  it('washes the body in the state hue with a soft elevation and no border', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" testId="shell" />);
    const cls = screen.getByTestId('shell').className;
    expect(cls).toContain('bg-blue-500/[0.08]');
    expect(cls).toContain('shadow-elevation-1');
    expect(cls).not.toMatch(/\bborder(-|\b)/);
    expect(screen.getByTestId('shell').dataset.style).toBeUndefined();
  });

  it('draws the elapsed fill as a labelled bar across the bottom edge, never a symbol in the row', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" testId="shell" />);
    expect(symbols()).toEqual(['state', 'origin', 'project']);
    const strip = screen.getByTestId('fleet-node-elapsed');
    expect(strip.dataset.fill).toBe('0.50');
    expect(strip.getAttribute('role')).toBe('img');
    expect(strip.getAttribute('aria-label')).toMatch(/\S/);
    const bar = screen.getByTestId('fleet-node-elapsed-bar');
    expect(bar.style.width).toBe('50%');
    expect(bar.className).toContain('bg-blue-400');
    expect(screen.getByTestId('fleet-node-symbols').contains(strip)).toBe(false);
  });

  it('paints every symbol as a hue circle with the glyph cut out', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-state').className).toContain('bg-blue-400 text-background');
    expect(screen.getByTestId('fleet-queue-origin').className).toContain('rounded-full bg-blue-400 text-background');
  });

  it('over-admitted wears the warning hue on the body wash and the state symbol', () => {
    wrap(<FleetNode kind="session" session={session()} overAdmitted ariaLabel="x" tooltip="x" testId="shell" />);
    expect(screen.getByTestId('shell').className).toContain('status-warning');
    expect(screen.getByTestId('fleet-node-state').className).toContain('status-warning');
  });
});

describe('FleetNode — affordances and motion', () => {
  it('renders the wrapper\'s affordances as siblings of the body, never inside it', () => {
    wrap((
      <FleetNode
        kind="session" session={session()} ariaLabel="x" tooltip="x" bodyTestId="body" onActivate={() => {}}
        symbols={<button type="button" aria-label="Session recap" data-testid="recap" />}
      />
    ));
    const recap = screen.getByTestId('recap');
    expect(screen.getByTestId('body').contains(recap)).toBe(false);
    expect(screen.getByTestId('fleet-node-affordances').contains(recap)).toBe(true);
    expect(screen.getByTestId('fleet-node-affordances').className).toContain('group-focus-within:opacity-100');
  });

  it('renders no affordance cluster when the wrapper hands none', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    expect(has('fleet-node-affordances')).toBe(false);
  });

  it('pulses the running dot only while motion is allowed', () => {
    wrap(<FleetNode kind="session" session={session()} ariaLabel="x" tooltip="x" />);
    expect(screen.getByTestId('fleet-node-state').firstElementChild!.className).toContain('animate-pulse');
    wrap(<FleetNode kind="session" session={session({ id: 'rm' })} reducedMotion ariaLabel="y" tooltip="y" testId="rm" />);
    expect(screen.getByTestId('rm').querySelector('[data-testid="fleet-node-state"]')!.firstElementChild!.className).not.toContain('animate-pulse');
  });
});

describe('the elapsed arithmetic', () => {
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

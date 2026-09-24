// The simulated fleet's two contracts.
//
// 1. THE SHAPE IS THE BRIEF. 20 projects, 3 agents in each, 5 Claude plans. A
//    fixture that quietly drifts to 19 projects still LOOKS like a full board,
//    which is exactly the class of regression a screenshot cannot catch.
// 2. THE GUARD IS STRUCTURAL. `setSimulation(true)` must refuse outside a test
//    build. That is the only thing standing between mock data and a real
//    operator's Monitor, and it is one boolean — so it is asserted rather than
//    assumed.
//
// The board's own branches are asserted through the REAL grouping code
// (`groupFleet`, `groupSessions`), not by re-reading the fixture: the point of
// substituting at the props boundary is that everything below it runs for real,
// and a test that skipped it would prove nothing about that.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { groupFleet, squareState, type SquareState } from '../../fleetGridModel';
import { buildSimRoster } from '../simFleet';
import { buildSimCards } from '../simCards';
import {
  buildSimQueueSnapshot, buildSimSessions, LONG_TITLES, SHORT_TITLES, SIM_LIVE_SESSIONS, SIM_QUEUE_CAP, SIM_QUEUED_SESSIONS,
} from '../simSessions';
import { buildSimAccountsSnapshot } from '../simPlans';
import { buildSimRail } from '../simRail';
import { groupSessions } from '../../fleetSessionModel';
import {
  _resetSimulationForTests, isTestBuild, setSimulation, simulationEnabled, toggleSimulation,
} from '../simulationMode';
import { _resetSimWorldForTests, simWorld } from '../useSimWorld';

const testWindow = () => window as unknown as { __PERSONAS_TEST_MODE__?: boolean };

afterEach(() => {
  delete testWindow().__PERSONAS_TEST_MODE__;
  _resetSimulationForTests();
  _resetSimWorldForTests();
});

describe('the simulated roster', () => {
  it('is 20 projects with 3 agents each, one team and one dev_project per project', () => {
    const roster = buildSimRoster();
    expect(roster.teams).toHaveLength(20);
    expect(roster.projects).toHaveLength(20);
    expect(roster.personas).toHaveLength(60);
    for (const team of roster.teams) {
      expect(roster.personas.filter((p) => p.home_team_id === team.id)).toHaveLength(3);
      expect(roster.projects.filter((p) => p.team_id === team.id)).toHaveLength(1);
    }
  });

  it('groups into 20 columns of 3 through the board\'s own grouper', () => {
    const roster = buildSimRoster();
    const grouped = groupFleet(buildSimCards(roster), roster.personas, roster.teams);
    expect(grouped.teams).toHaveLength(20);
    expect(grouped.ungrouped).toHaveLength(0);
    for (const column of grouped.teams) expect(column.cards).toHaveLength(3);
  });

  it('names an agent without its project, and never repeats a name inside one', () => {
    const roster = buildSimRoster();
    for (const persona of roster.personas) {
      const team = roster.teams.find((tm) => tm.id === persona.home_team_id);
      // The column header already says which project a node is in; repeating it
      // inside a 172px node truncates the part that distinguishes the agent.
      expect(persona.name).not.toContain(team!.name);
    }
    for (const team of roster.teams) {
      const names = roster.personas.filter((p) => p.home_team_id === team.id).map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('is deterministic — two builds at the same instant are the same board', () => {
    const at = 1_700_000_000_000;
    expect(JSON.stringify(buildSimCards(buildSimRoster(), at)))
      .toBe(JSON.stringify(buildSimCards(buildSimRoster(), at)));
  });
});

describe('the simulated cards', () => {
  it('paint all four tile states', () => {
    const cards = buildSimCards(buildSimRoster());
    const seen = new Set<SquareState>(cards.map(squareState));
    expect([...seen].sort()).toEqual(['attention', 'failed', 'idle', 'running']);
  });

  it('reach every state within the first twenty tiles', () => {
    const cards = buildSimCards(buildSimRoster()).slice(0, 20);
    expect(new Set(cards.map(squareState)).size).toBe(4);
  });
});

describe('the simulated sessions', () => {
  it('route to columns by cwd, and leave two the board cannot place', () => {
    const roster = buildSimRoster();
    const grouping = groupSessions(buildSimSessions(roster), roster.projects);
    expect(grouping.byTeam.size).toBeGreaterThan(0);
    // Exactly the two written with a cwd no project owns — this is the tray's
    // session lane, and it is the branch a healthy real fleet rarely produces.
    expect(grouping.ungrouped).toHaveLength(2);
  });

  it('leaves some columns with no sessions, so the divider branch stays honest', () => {
    const roster = buildSimRoster();
    const grouping = groupSessions(buildSimSessions(roster), roster.projects);
    const withNone = roster.teams.filter((tm) => !grouping.byTeam.has(tm.id));
    expect(withNone.length).toBeGreaterThan(0);
  });

  it('seeds ten live rows and thirty queued rows, ranks 1..30, mixed origins, some gated', () => {
    const now = 1_700_000_000_000;
    const sessions = buildSimSessions(buildSimRoster(), now);
    const live = sessions.filter((x) => x.state !== 'queued');
    const queued = sessions.filter((x) => x.state === 'queued');
    expect(live).toHaveLength(SIM_LIVE_SESSIONS);
    expect(queued).toHaveLength(SIM_QUEUED_SESSIONS);
    expect(queued.map((x) => x.queueRank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(new Set(queued.map((x) => x.origin)).size).toBeGreaterThan(4);
    const gated = queued.filter((x) => x.notBeforeMs !== null);
    expect(gated.length).toBeGreaterThan(0);
    for (const g of gated) expect(Number(g.notBeforeMs)).toBeGreaterThan(now);
    // A queued row holds no process.
    for (const q of queued) expect(q.childPid).toBeNull();
  });

  it('mixes LONG titles (≥ 40, truncation visible) with SHORT ones (≤ 24, the row holds them whole), in both bands', () => {
    const sessions = buildSimSessions(buildSimRoster(), 1_700_000_000_000);
    const long = sessions.filter((x) => (x.title ?? '').length >= 40);
    const short = sessions.filter((x) => (x.title ?? '').length <= 24);
    expect(long.length + short.length).toBe(sessions.length);
    expect(long.length).toBeGreaterThan(0);
    expect(short.length).toBeGreaterThan(0);
    expect(SHORT_TITLES).toHaveLength(10);
    for (const t of SHORT_TITLES) expect(t.length).toBeLessThanOrEqual(24);
    for (const t of LONG_TITLES) expect(t.length).toBeGreaterThanOrEqual(40);
    // Both lengths appear among the live rows AND among the queued rows, so
    // every board shows the untruncated case beside the truncated one.
    const live = sessions.filter((x) => x.state !== 'queued');
    const queued = sessions.filter((x) => x.state === 'queued');
    for (const band of [live, queued]) {
      expect(band.some((x) => (x.title ?? '').length >= 40)).toBe(true);
      expect(band.some((x) => (x.title ?? '').length <= 24)).toBe(true);
    }
  });

  it('paints every state, every origin and every symbol at least once', () => {
    const sessions = buildSimSessions(buildSimRoster(), 1_700_000_000_000);
    const live = sessions.filter((x) => x.state !== 'queued');
    // Every state the board paints (spawning and exited are transient by design).
    expect(new Set(live.map((x) => x.state))).toEqual(new Set(['running', 'awaiting_input', 'idle', 'stale', 'finished', 'hibernated']));
    // Every origin, on the live band (classic board) and on the queue.
    const all = ['manual', 'dev_runner', 'dispatch_ideas', 'athena', 'autopilot', 'night_shift', 'feed_impact', 'orphan_resume'];
    expect(new Set(live.map((x) => x.origin))).toEqual(new Set(all));
    expect(new Set(sessions.filter((x) => x.state === 'queued').map((x) => x.origin))).toEqual(new Set(all));
    // The rank, the gate and the elapsed ring: a queued row with a rank, a
    // gated one, and a running row for the ring.
    expect(sessions.some((x) => x.state === 'queued' && x.queueRank !== null && x.notBeforeMs !== null)).toBe(true);
    expect(live.some((x) => x.state === 'running')).toBe(true);
    // The project swatch: every row carries a project label.
    for (const x of sessions) expect(x.projectLabel).toBeTruthy();
  });

  it('fabricates a snapshot consistent with the rows at a cap of ten', () => {
    const now = 1_700_000_000_000;
    const sessions = buildSimSessions(buildSimRoster(), now);
    const snap = buildSimQueueSnapshot(sessions, now);
    expect(snap.cap).toBe(SIM_QUEUE_CAP);
    expect(snap.running).toBe(SIM_LIVE_SESSIONS);
    expect(snap.queued).toBe(SIM_QUEUED_SESSIONS);
    expect(snap.overAdmitted).toBe(0);
    expect(snap.entries.map((e) => e.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // Estimates grow with rank, from now.
    const est = snap.entries.map((e) => Number(e.estimatedStartMs));
    for (let i = 1; i < est.length; i += 1) expect(est[i]!).toBeGreaterThan(est[i - 1]!);
    expect(est[0]!).toBeGreaterThan(now);
  });
});

describe('the simulated plans', () => {
  it('fill the strip\'s five slots and cover its four card branches', () => {
    const snap = buildSimAccountsSnapshot(1_700_000_000_000);
    expect(snap.accounts).toHaveLength(5);
    expect(snap.accounts.filter((a) => a.isActive)).toHaveLength(1);
    expect(snap.accounts.some((a) => a.usageProjectedFromMs !== null)).toBe(true);
    expect(snap.accounts.some((a) => a.quarantineReason !== null)).toBe(true);
    expect(snap.accounts.some((a) => a.usageReason !== null && a.quarantineReason === null)).toBe(true);
  });
});

describe('the simulated rail', () => {
  it('gives every tab more rows than one page, so paging is exercised', () => {
    const rows = buildSimRail({ review: 'Review', dispatch: 'Dispatch', message: 'Message' });
    expect(rows.reviews.length).toBeGreaterThan(30);
    expect(rows.dispatch.length).toBeGreaterThan(0);
    expect(rows.messages.length).toBeGreaterThan(0);
    // Messages are threads: no group bands, some unread, some read (so the
    // unread-only default and the "All threads" toggle both have work to do).
    expect(rows.messages.every((r) => r.groupHeader === null)).toBe(true);
    expect(rows.messages.some((r) => r.unread)).toBe(true);
    expect(rows.messages.some((r) => !r.unread)).toBe(true);
  });

  it('offers no verdict on a simulated review — there is no door to write through', () => {
    const rows = buildSimRail({ review: 'Review', dispatch: 'Dispatch', message: 'Message' });
    expect(rows.reviews.every((r) => !r.decidable)).toBe(true);
  });
});

describe('the test-build guard', () => {
  beforeEach(() => {
    delete testWindow().__PERSONAS_TEST_MODE__;
    _resetSimulationForTests();
  });

  it('refuses to turn on outside a test build', () => {
    expect(isTestBuild()).toBe(false);
    setSimulation(true);
    expect(simulationEnabled()).toBe(false);
    toggleSimulation();
    expect(simulationEnabled()).toBe(false);
  });

  it('toggles on and back off when the bridge flag is present', () => {
    testWindow().__PERSONAS_TEST_MODE__ = true;
    toggleSimulation();
    expect(simulationEnabled()).toBe(true);
    toggleSimulation();
    expect(simulationEnabled()).toBe(false);
  });
});

describe('the world singleton', () => {
  it('hands back the same objects, so memoized tiles are not re-created', () => {
    const first = simWorld();
    expect(simWorld().cards).toBe(first.cards);
    expect(simWorld().cards[0]).toBe(first.cards[0]);
  });
});

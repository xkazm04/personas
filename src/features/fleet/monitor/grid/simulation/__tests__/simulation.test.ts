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
import { simHourlyRuns, SIM_HOURLY_WINDOW } from '../simHourly';
import { SIM_LOAD_AGENTS_PER_PROJECT } from '../simRandom';
import { severityBucket } from '../../../monitorModel';
import {
  buildSimQueueSnapshot, buildSimSessions, LONG_TITLES, SHORT_TITLES, SIM_LIVE_SESSIONS, SIM_QUEUE_CAP, SIM_QUEUED_SESSIONS,
} from '../simSessions';
import { buildSimAccountsSnapshot, simRelogin, simSaveProfile, simSetProfile } from '../simPlans';
import { buildSimRail } from '../simRail';
import { groupSessions } from '../../fleetSessionModel';
import {
  _resetSimulationForTests, isTestBuild, setSimulation, simulationEnabled, toggleSimulation,
} from '../simulationMode';
import { _resetSimWorldForTests, simLoadFleet, simWorld } from '../useSimWorld';

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
  const NOW = 1_700_000_000_000;

  it("fills the strip's seven slots and covers its card branches", () => {
    const snap = buildSimAccountsSnapshot(NOW);
    expect(snap.accounts).toHaveLength(7);
    expect(snap.accounts.filter((a) => a.isActive)).toHaveLength(1);
    expect(snap.accounts.some((a) => a.usageProjectedFromMs !== null)).toBe(true);
    expect(snap.accounts.some((a) => a.quarantineReason !== null)).toBe(true);
    expect(snap.accounts.some((a) => a.usageReason !== null && a.quarantineReason === null)).toBe(true);
  });

  it('cover every re-login state: running, needs you (two reasons) and done', () => {
    const { accounts } = buildSimAccountsSnapshot(NOW);
    const seen = accounts.flatMap((a) => (a.relogin ? [`${a.relogin.phase}:${a.relogin.step ?? a.relogin.reason ?? ''}`] : []));
    expect(seen.sort()).toEqual([
      'done:', 'needs_you:profile_cold', 'needs_you:proton_second_factor', 'running:waiting_for_code',
    ]);
    // Every run belongs to the account that carries it.
    expect(accounts.every((a) => a.relogin === null || a.relogin.accountId === a.id)).toBe(true);
  });

  it('ships the profiles the plans are linked to', () => {
    const snap = buildSimAccountsSnapshot(NOW);
    const keys = snap.profiles.map((p) => p.key);
    const linked = snap.accounts.flatMap((a) => [a.login?.profileKey, a.login?.codeInboxProfileKey]).filter(Boolean);
    expect(linked.every((k) => keys.includes(k as string))).toBe(true);
  });

  it('a simulated re-login revives a linked plan and stops at profile_not_linked for an unlinked one', () => {
    const snap = buildSimAccountsSnapshot(NOW);
    const revived = simRelogin(snap, 'sim-plan-5', NOW).accounts.find((a) => a.id === 'sim-plan-5')!;
    expect(revived.quarantineReason).toBeNull();
    expect(revived.relogin).toMatchObject({ phase: 'done', startedAtMs: NOW });
    const unlinked = simRelogin(simSetProfile(snap, 'sim-plan-5', null, null, false), 'sim-plan-5', NOW)
      .accounts.find((a) => a.id === 'sim-plan-5')!;
    expect(unlinked.quarantineReason).not.toBeNull();
    expect(unlinked.relogin).toMatchObject({ phase: 'needs_you', reason: 'profile_not_linked' });
  });

  it('saves and links profiles in place', () => {
    const snap = buildSimAccountsSnapshot(NOW);
    const made = simSaveProfile(snap, 'home', 'Home', null);
    expect(made.profiles.map((p) => p.key)).toContain('home');
    const bound = simSaveProfile(made, 'home', 'Home', 'sim-vault-proton');
    expect(bound.profiles.filter((p) => p.key === 'home')).toHaveLength(1);
    expect(bound.profiles.find((p) => p.key === 'home')!.vaultCredentialId).toBe('sim-vault-proton');
    const linked = simSetProfile(bound, 'sim-plan-4', 'home', 'proton-inbox', true);
    expect(linked.accounts.find((a) => a.id === 'sim-plan-4')!.login).toEqual({
      profileKey: 'home', codeInboxProfileKey: 'proton-inbox', reloginUnattended: true,
    });
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

describe('the load-shape roster (the size knob)', () => {
  it('builds 20 projects with 5 agents each — 100 agents — and keeps names distinct per project', () => {
    const roster = buildSimRoster(SIM_LOAD_AGENTS_PER_PROJECT);
    expect(roster.teams).toHaveLength(20);
    expect(roster.personas).toHaveLength(100);
    expect(new Set(roster.personas.map((p) => p.id)).size).toBe(100);
    for (const team of roster.teams) {
      const names = roster.personas.filter((p) => p.home_team_id === team.id).map((p) => p.name);
      expect(names).toHaveLength(5);
      expect(new Set(names).size).toBe(5);
    }
    const grouped = groupFleet(buildSimCards(roster), roster.personas, roster.teams);
    expect(grouped.teams).toHaveLength(20);
    for (const column of grouped.teams) expect(column.cards).toHaveLength(5);
  });

  it('leaves the default at 60 agents', () => {
    expect(buildSimRoster().personas).toHaveLength(60);
  });

  it('switches a few agents Off, and an Off agent is idle', () => {
    for (const roster of [buildSimRoster(), buildSimRoster(SIM_LOAD_AGENTS_PER_PROJECT)]) {
      const cards = buildSimCards(roster);
      const off = cards.filter((c) => c.enabled === false);
      expect(off.length).toBeGreaterThan(0);
      expect(off.length).toBeLessThan(cards.length / 10);
      for (const c of off) {
        expect(roster.personas.find((p) => p.id === c.personaId)!.enabled).toBe(false);
        expect(c.running + c.queued + c.inputRequired + c.draftReady + c.attentionCount).toBe(0);
      }
      // The Off agents are not all in one project.
      const teamsOff = new Set(off.map((c) => roster.personas.find((p) => p.id === c.personaId)!.home_team_id));
      expect(teamsOff.size).toBe(off.length);
    }
  });

  it('still paints all four tile states at 100 agents', () => {
    const cards = buildSimCards(buildSimRoster(SIM_LOAD_AGENTS_PER_PROJECT));
    expect([...new Set(cards.map(squareState))].sort()).toEqual(['attention', 'failed', 'idle', 'running']);
  });
});

describe('the simulated health', () => {
  const cards = buildSimCards(buildSimRoster(SIM_LOAD_AGENTS_PER_PROJECT), 1_700_000_000_000);

  it('carries up to ten recent outcomes, most agents a full ten', () => {
    for (const c of cards) expect(c.recentStatuses.length).toBeLessThanOrEqual(10);
    expect(cards.filter((c) => c.recentStatuses.length === 10).length).toBeGreaterThan(cards.length / 2);
  });

  it('derives success rate, health and totalRecent from the outcomes, as the backend does', () => {
    for (const c of cards) {
      const n = c.recentStatuses.length;
      expect(c.totalRecent).toBe(n);
      if (n === 0) {
        expect(c.healthStatus).toBe('dormant');
        expect(c.successRate).toBeNull();
        expect(c.runsToday).toBe(0);
        continue;
      }
      const completed = c.recentStatuses.filter((s) => s === 'completed').length;
      const failRatio = c.recentStatuses.filter((s) => s === 'failed').length / n;
      expect(c.successRate).toBeCloseTo(completed / n, 10);
      const expected = failRatio === 0 ? 'healthy' : failRatio >= 0.6 ? 'failing' : 'degraded';
      expect(c.healthStatus).toBe(expected);
    }
  });

  it('agrees with the tile: only a failed tile has a failed newest outcome', () => {
    for (const c of cards) {
      expect(c.recentStatuses[0] === 'failed').toBe(squareState(c) === 'failed');
    }
  });

  it('covers every health level, and a running agent has run today', () => {
    expect(new Set(cards.map((c) => c.healthStatus))).toEqual(new Set(['healthy', 'degraded', 'failing', 'dormant']));
    for (const c of cards.filter((x) => x.running > 0)) expect(c.runsToday).toBeGreaterThan(0);
  });

  it('includes medium reviews, bucketed as warnings', () => {
    const medium = cards.filter((c) => c.reviews.some((r) => r.severity === 'medium'));
    expect(medium.length).toBeGreaterThan(0);
    for (const c of medium) {
      expect(severityBucket('medium')).toBe('warning');
      expect(c.topReviewSeverity).toBe('warning');
      expect(c.reviewCounts.critical).toBe(0);
      expect(c.reviewCounts.warning).toBe(c.reviews.length);
    }
  });
});

describe('the simulated runs per hour', () => {
  // 2023-11-14 22:13:20 UTC: 23 hours of "today" sit inside the 24h window.
  const NOW = 1_700_000_000_000;
  const cards = buildSimCards(buildSimRoster(SIM_LOAD_AGENTS_PER_PROJECT), NOW);
  const rows = simHourlyRuns(cards, NOW);

  it("matches the command's shape: 24 buckets, a row only for agents that ran", () => {
    expect(SIM_HOURLY_WINDOW).toBe(24);
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows) {
      expect(r.buckets).toHaveLength(24);
      expect(r.buckets.some((n) => n > 0)).toBe(true);
      expect(r.buckets.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    }
    const ids = new Set(rows.map((r) => r.personaId));
    for (const c of cards) if (c.recentStatuses.length === 0) expect(ids.has(c.personaId)).toBe(false);
  });

  it("sums today's buckets to the card's runsToday, with a running agent's run in the current hour", () => {
    const todayHours = new Date(NOW).getUTCHours() + 1;
    const byId = new Map(rows.map((r) => [r.personaId, r.buckets]));
    for (const c of cards) {
      const buckets = byId.get(c.personaId) ?? new Array<number>(24).fill(0);
      const today = buckets.slice(24 - todayHours).reduce((a, b) => a + b, 0);
      expect(today).toBe(c.runsToday);
      if (c.running > 0) expect(buckets[23]!).toBeGreaterThan(0);
    }
  });

  it('is deterministic, and clamps the window like the backend', () => {
    expect(JSON.stringify(simHourlyRuns(cards, NOW))).toBe(JSON.stringify(rows));
    for (const r of simHourlyRuns(cards, NOW, 1_000)) expect(r.buckets).toHaveLength(168);
    for (const r of simHourlyRuns(cards, NOW, 0)) expect(r.buckets).toHaveLength(1);
  });
});

describe('the load fleet singleton', () => {
  it('is 100 agents with their hourly rows, built once', () => {
    const first = simLoadFleet();
    expect(first.cards).toHaveLength(100);
    expect(first.hourly.length).toBeGreaterThan(0);
    expect(simLoadFleet()).toBe(first);
  });
});

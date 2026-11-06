/**
 * DEV fixture, part 2: the three lives of one standup on the staged record,
 * as the exact wire shapes the IPC returns (so the page renders them through
 * the same `buildView` path as live data). Never imported outside a DEV branch.
 */
import type { ForecastSlot } from '@/lib/bindings/ForecastSlot';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Standup } from '@/lib/bindings/Standup';
import type { StandupItem } from '@/lib/bindings/StandupItem';
import type { StandupReport } from '@/lib/bindings/StandupReport';
import type { ViewInput } from '../model/buildView';
import { at, DAY_EVENTS, HISTORY, NIGHT_EVENTS, PERSONAS, PROJECTS, PROPOSALS } from './fixtureRecord';

export type FixtureScenario = 'decide' | 'armed' | 'return';
export type FixtureData = Omit<ViewInput, 'nowMs'> & { nowMs: number };

const ARMED_AT = at(17, 20);
const NOW: Record<FixtureScenario, number> = { decide: at(17, 10), armed: at(21, 40), return: at(7, 45, 1) };

function item(id: string, projectId: string | undefined, kind: StandupItem['kind'], priority: number, evidence: string, extra: Partial<StandupItem> = {}): StandupItem {
  return { id, kind, projectId, deviceId: 'this-pc', state: 'proposed', proposals: PROPOSALS[projectId ?? ''] ?? [], window: 'night', priority, evidence, ...extra };
}

function items(scenario: FixtureScenario): StandupItem[] {
  const decided = scenario !== 'decide';
  const pick = (pid: string, i: number): Partial<StandupItem> => ({ state: 'accepted', chosen: PROPOSALS[pid]![i]!.text });
  return [
    item('i-cc', 'castlecontrol', 'direction', 1, 'Chambers are ported and pushed; the final is 11-02. The shell was left untouched as agreed.', decided ? pick('castlecontrol', 0) : {}),
    item('i-pp', 'paypal', 'direction', 2, 'Frozen for the D1 history rewrite. The push command is ready and only you can run it.', pick('paypal', 0)),
    item('i-ov', 'overlord', 'direction', 3, 'Row-18 lead fixed and pushed; coverage 22.66% to 96.79%. Its directions are complete.', decided ? pick('overlord', 0) : {}),
    item('i-kp', 'kp', 'direction', 4, 'Waiting for a kp standup since 10-29: 11 commits unpushed, two held branches.', { state: 'edited', chosen: 'Gate the 11 held commits, push only the SSRF fix tonight' }),
    item('i-ds', 'devsecops', 'direction', 5, 'Not named since 10-23. The ledgerline infra fix was written and never applied.', decided ? { state: 'skipped' } : {}),
    item('i-gv', 'gravitone-gcloud', 'direction', 6, 'Not named since 10-19. Milestone 1 was planned, the probe data never repaired.'),
    item('i-as', 'ascent', 'direction', 7, 'Never armed in a standup. Its App Master ran 23 times; its charters are scans.', decided ? pick('ascent', 0) : {}),
    item('i-a1', undefined, 'create_agent', 10, 'Armed in 6 of the last 12 standups, yet no persona or charter owns it. A standing master at rung 2, merge never, push origin main.', {
      createSpec: { name: 'App Master CastleControl', role: 'app-master', projectId: 'castlecontrol', charter: 'Rung 2, merge never, push origin main.' }, ...(decided ? { state: 'accepted' } : {}),
    }),
    item('i-a2', 'mage-arena-vr', 'retune_agent', 11, 'Enabled here, but the repo left this machine for the Lynx PC on 10-28. Disable it on this machine.', { retuneSpec: { personaId: 'p-mage', note: 'disable on this machine' }, personaId: 'p-mage' }),
    item('i-a3', 'kp', 'retune_agent', 12, 'Disabled, yet it still holds the $120/month charter App Master CandiDate runs. Move the budget across.', { retuneSpec: { personaId: 'p-kpgate' }, personaId: 'p-kpgate' }),
    item('i-f1', 'pof', 'filler', 20, 'Report-only scans fill dead spots tonight (charter: codebase security scan).', { proposals: [] }),
    item('i-f2', 'garden-vr', 'filler', 21, 'Report-only static sweep, only when the machine idles.', { proposals: [] }),
    item('i-b1', 'athena-portable', 'direction', 30, 'Nothing to ground a proposal on: no charter, no App Master, never in a standup. Type the direction.', { proposals: [] }),
    item('i-b2', 'tracklight', 'direction', 31, 'Nothing to ground a proposal on: 4 headless calls, last 10-21. Type the direction.', { proposals: [] }),
    item('i-r1', 'mage-arena-vr', 'direction', 40, 'Moved to the Lynx PC on 10-28 for visual fidelity work.', { proposals: [] }),
  ];
}

const slot = (itemId: string, h: number, m: number, minutes: number, units = 2, day = 0): ForecastSlot => {
  const startMs = at(h, m, day);
  return { itemId, startMs, endMs: startMs + minutes * 60_000, machineUnits: units, gpu: false, confidence: 0.6 };
};

/** Directions at the measured 23-min median, one builder per project; fill in the dead spots. */
function forecast(scenario: FixtureScenario): ForecastSlot[] {
  const base = [slot('i-pp', 17, 35, 23, 1), slot('i-kp', 17, 35, 23), slot('i-kp', 18, 5, 23)];
  if (scenario === 'decide') return [...base, slot('i-f1', 19, 0, 23, 1), slot('i-f2', 22, 30, 23, 1)];
  return [
    ...base,
    slot('i-cc', 17, 35, 23), slot('i-cc', 18, 30, 23), slot('i-cc', 21, 20, 23), slot('i-cc', 23, 5, 23), slot('i-cc', 0, 40, 23, 2, 1), slot('i-cc', 1, 15, 23, 2, 1),
    slot('i-ov', 19, 0, 23), slot('i-ov', 19, 30, 23), slot('i-ov', 21, 30, 23), slot('i-ov', 22, 0, 23),
    slot('i-as', 20, 0, 23, 1), slot('i-as', 2, 30, 23, 1, 1),
    slot('i-f1', 19, 45, 23, 1), slot('i-f2', 23, 40, 23, 1), slot('i-f1', 3, 30, 23, 1, 1),
  ];
}

/** A host series shaped like the day's log: busy until the 12:25 stop, one builder after, idle since 16:23. */
function utilization(scenario: FixtureScenario): HostUtilizationPoint[] {
  const out: HostUtilizationPoint[] = [];
  const end = NOW[scenario];
  for (let t = at(6, 0); t < end; t += 60_000) {
    const h = new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60 + (t >= at(0, 0, 1) ? 24 : 0);
    const running = h < 12.4 ? 4 : h < 12.55 ? 0 : h < 16.4 ? 1 : h >= 17.5 && h < 26 ? 2 : 0;
    const wave = 0.5 + 0.5 * Math.sin(t / 3_600_000);
    const cpu = running ? Math.min(0.92, 0.12 * running + 0.18 * wave) : 0.04 + 0.03 * wave;
    out.push({ minuteMs: t, cpuAvg: cpu, cpuMax: Math.min(1, cpu + 0.08), ramAvg: 0.4, fleetRunning: running, fleetQueued: 0 });
  }
  return out;
}

function report(scenario: FixtureScenario): StandupReport {
  const night = scenario === 'return';
  return {
    sinceMs: night ? ARMED_AT : at(6, 0),
    projects: [
      { projectId: 'castlecontrol', moved: (night ? ['a41c2e0', 'b7d93f1', 'c02e8aa', 'd5f1c3b'] : ['39bf3b6', '14d2e78', 'e9521db', '68a6147', '4de25a8', '2ebd543', '99e9e47', '7dffa07', 'af5e2f1']).map((sha) => ({ sha, summary: 'merged and pushed' })), running: 0,
        parked: [{ eventId: 'ask-build', summary: 'Shared build folder for builder worktrees', options: ['one shared target folder', 'keep per-worktree targets'] }, { eventId: 'ask-e2e', summary: 'Make the CI e2e job blocking', options: ['blocking', 'keep non-blocking'] }] },
      { projectId: 'paypal', moved: [{ sha: '5c0ffee', summary: 'D1 staged' }], running: 0, parked: [{ eventId: 'ask-d1', summary: 'Run the D1 force-push', options: ['run it', 'hold'] }] },
      { projectId: 'overlord', moved: [], running: 0, parked: [{ eventId: 'ask-tour', summary: 'Approve a tournament (spend)', options: ['cap $20', 'not now'] }] },
      { projectId: 'kp', moved: night ? [{ sha: '91e0a7d', summary: 'SSRF fix' }] : [], running: 0, parked: night ? [] : [{ eventId: 'ask-kp', summary: '11 unpushed kp commits, incl. the SSRF fix', options: ['push', 'hold'] }] },
    ],
    createdAgents: night ? [{ personaId: 'p-cc', name: 'App Master CastleControl', away: true }] : [],
  };
}

export function buildFixture(scenario: FixtureScenario): FixtureData {
  const standup: Standup = {
    id: `fixture-${scenario}`, revision: 2, parentId: 'fixture-rev1', status: scenario === 'decide' ? 'draft' : 'armed', deviceId: 'this-pc',
    openedAt: at(17, 0), ...(scenario !== 'decide' && { armedAt: ARMED_AT }),
    plan: { items: items(scenario) },
    awayRules: { delegate: ['scope', 'goals', 'dependency_bump', 'retune', 'create_agent'], park: ['money', 'data', 'schema', 'secrets', 'push'], pushTargets: [{ projectId: 'castlecontrol', remote: 'origin', branch: 'main' }, { projectId: 'kp', remote: 'origin', branch: 'main' }] },
    ...(scenario !== 'armed' && { report: report(scenario) }),
  };
  return {
    standup,
    events: scenario === 'decide' ? DAY_EVENTS : [...DAY_EVENTS, ...NIGHT_EVENTS.filter((e) => e.at <= NOW[scenario])],
    forecast: forecast(scenario),
    utilization: utilization(scenario),
    projectNames: PROJECTS,
    personaNames: PERSONAS,
    history: HISTORY,
    refusals: { 'i-r1': 'A headless App Master on the Lynx PC holds mage-arena-vr (heartbeat headless_master:23144). This plan will not dispatch it.' },
    nowMs: NOW[scenario],
  };
}

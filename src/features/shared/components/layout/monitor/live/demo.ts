// Demo driver for the live-mode prototype — synthesizes realistic channel
// messages so the three variants can be A/B'd live without running real teams.
// THROWAWAY: deleted at consolidation; production wiring projects the real
// useTeamChannel feed into LiveMessage instead.

import type { LiveMessage } from './liveModel';

interface DemoTeam { teamId: string; teamName: string; teamColor: string }
interface DemoPersona { id: string; name: string; icon: string; color: string }

const TEAMS: DemoTeam[] = [
  { teamId: 'web', teamName: 'Web Platform', teamColor: '#6366f1' },
  { teamId: 'growth', teamName: 'Growth Pod', teamColor: '#10b981' },
  { teamId: 'data', teamName: 'Data Guild', teamColor: '#f59e0b' },
  { teamId: 'sec', teamName: 'Security', teamColor: '#ef4444' },
];

const PERSONAS: Record<string, DemoPersona[]> = {
  web: [
    { id: 'web-1', name: 'Atlas', icon: '🛰️', color: '#818cf8' },
    { id: 'web-2', name: 'Forge', icon: '🔧', color: '#a78bfa' },
  ],
  growth: [
    { id: 'gr-1', name: 'Spark', icon: '🚀', color: '#34d399' },
    { id: 'gr-2', name: 'Pulse', icon: '📈', color: '#2dd4bf' },
  ],
  data: [
    { id: 'da-1', name: 'Quill', icon: '📊', color: '#fbbf24' },
    { id: 'da-2', name: 'Cypher', icon: '🧮', color: '#f59e0b' },
  ],
  sec: [
    { id: 'se-1', name: 'Aegis', icon: '🛡️', color: '#f87171' },
  ],
};

interface Template {
  kind: LiveMessage['kind'];
  event: string;
  tone: string;
  alert?: boolean;
  body: (p: string) => string;
}

// Weighted-ish vocabulary across the channel kinds, drawn from the real
// STEP_VERB / FAMILY / author vocabularies (collabRender).
const TEMPLATES: Template[] = [
  { kind: 'step', event: 'needs your review', tone: 'text-status-warning', alert: true, body: () => 'Draft PR ready — awaiting approval before merge' },
  { kind: 'step', event: 'finished', tone: 'text-status-success', body: () => 'Completed migration of the billing schema' },
  { kind: 'step', event: 'started', tone: 'text-status-info', body: () => 'Picked up the onboarding-funnel task' },
  { kind: 'step', event: 'failed', tone: 'text-status-error', alert: true, body: () => 'Test suite failed — 3 assertions in checkout flow' },
  { kind: 'event', event: 'handoff', tone: 'text-violet-300', body: (p) => `Handed the spec off to ${p}` },
  { kind: 'event', event: 'pr opened', tone: 'text-status-info', body: () => 'feat: parallelize the embedding pipeline (#482)' },
  { kind: 'event', event: 'release', tone: 'text-status-success', body: () => 'Shipped v2.4.0 to the staging channel' },
  { kind: 'athena', event: 'Athena', tone: 'text-violet-300', body: () => 'Noticed two stalled reviews — want me to nudge them?' },
  { kind: 'director', event: 'Director', tone: 'text-sky-300', body: () => 'Throughput up 18% this cycle; flagged one risky dependency' },
  { kind: 'directive', event: 'directive', tone: 'text-status-success', body: (p) => `Prioritize the auth refactor over the dashboard polish, ${p}` },
  { kind: 'memory', event: 'memory · decision', tone: 'text-amber-300/80', body: () => 'Recorded: standardize on RFC3339 timestamps across the bus' },
];

let seq = 0;
function pick<T>(arr: T[], n: number): T { return arr[n % arr.length]!; }

/** Build one demo message, optionally pinned to a specific team. */
export function makeMessage(teamId?: string): LiveMessage {
  const i = seq++;
  const team = teamId ? TEAMS.find((t) => t.teamId === teamId)! : pick(TEAMS, i * 7 + 3);
  const roster = PERSONAS[team.teamId]!;
  const persona = pick(roster, i * 5 + 1);
  const tpl = pick(TEMPLATES, i * 3 + i);
  const otherName = pick(roster, i + 1).name;
  const usesPersona = tpl.kind === 'step' || tpl.kind === 'event' || tpl.kind === 'memory';
  return {
    id: `demo-${i}-${team.teamId}`,
    teamId: team.teamId,
    teamName: team.teamName,
    teamColor: team.teamColor,
    personaId: usesPersona ? persona.id : tpl.kind === 'persona' ? persona.id : null,
    personaName: persona.name,
    personaIcon: persona.icon,
    personaColor: persona.color,
    kind: tpl.kind,
    event: tpl.event,
    tone: tpl.tone,
    message: tpl.body(otherName),
    at: new Date().toISOString(),
    alert: tpl.alert ?? false,
    receivedAt: Date.now(),
  };
}

/** A simultaneous burst from `n` distinct teams (tests multi-team delivery). */
export function makeBurst(n = 3): LiveMessage[] {
  const teams = TEAMS.slice(0, Math.min(n, TEAMS.length)).map((t) => t.teamId);
  return teams.map((id) => makeMessage(id));
}

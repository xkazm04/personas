/**
 * Fleet Activity's transcripts shaped for the composition kit. Pure functions,
 * so the page stays a composition. The joins (as the kit's contest entry made them):
 * a transcript takes its title and state from the registry session with the same claudeSessionId;
 * a transcript with no session is `gone`.
 */
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import type { Glyph, Tone } from '@/features/shared/components/kit';
import { projectLabel } from './activityTarget';

export type ActivityState = FleetSessionState | 'gone';

/** Tone x glyph per state: the same glyph on the spine, in a segment, in a unit square. */
export const STATE_GLYPH: Record<ActivityState, { tone: Tone; glyph: Glyph }> = {
  awaiting_input: { tone: 'warning', glyph: 'solid' },
  running: { tone: 'primary', glyph: 'live' },
  spawning: { tone: 'primary', glyph: 'soft' },
  queued: { tone: 'info', glyph: 'solid' },
  idle: { tone: 'neutral', glyph: 'solid' },
  stale: { tone: 'warning', glyph: 'soft' },
  finished: { tone: 'success', glyph: 'solid' },
  hibernated: { tone: 'neutral', glyph: 'soft' },
  exited: { tone: 'neutral', glyph: 'hollow' },
  expired: { tone: 'neutral', glyph: 'hollow' },
  gone: { tone: 'neutral', glyph: 'hollow' },
};

/** The variant's order for the state filter; only states present in the data are offered. */
export const STATE_ORDER: readonly ActivityState[] = [
  'awaiting_input', 'running', 'spawning', 'queued', 'idle', 'stale', 'finished', 'hibernated', 'exited', 'expired', 'gone',
];

/** Token claims, in the variant's order and roles. */
export const TOKEN_PARTS = [
  { k: 'input', tone: 'external' },
  { k: 'output', tone: 'agent' },
  { k: 'cacheCreation', tone: 'warning' },
  { k: 'cacheRead', tone: 'success' },
] as const satisfies ReadonlyArray<{ k: string; tone: Tone }>;

export type TokenKey = (typeof TOKEN_PARTS)[number]['k'];
export type Tokens = Record<TokenKey | 'total', number>;

export interface ActivitySession {
  id: string;
  row: FleetTranscriptSummary;
  title: string | null;
  project: string | null;
  model: string | null;
  models: string[];
  state: ActivityState;
  stateReason: string | null;
  origin: string | null;
  tokens: Tokens;
  cacheShare: number;
  toolCalls: number;
  durationMin: number | null;
}

/** Model ids arrive vendor-prefixed; the family-version tail is what a row needs. */
export function shortModel(m: string): string {
  return m.replace(/^[^-]+-(?=[a-z])/, '');
}

export function toActivitySession(row: FleetTranscriptSummary, live: FleetSession | undefined): ActivitySession {
  const tokens = {
    input: Number(row.tokens.input), output: Number(row.tokens.output),
    cacheCreation: Number(row.tokens.cacheCreation), cacheRead: Number(row.tokens.cacheRead), total: 0,
  };
  tokens.total = tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead;
  const first = row.firstTimestamp ? Date.parse(row.firstTimestamp) : NaN;
  const last = row.lastTimestamp ? Date.parse(row.lastTimestamp) : NaN;
  return {
    // The transcript's path: unique per file, where a session id stem need not be.
    id: row.path,
    row,
    title: live?.title ?? null,
    project: row.cwd ? projectLabel(row.cwd) : live?.projectLabel ?? null,
    model: row.models[0] ? shortModel(row.models[0]) : null,
    models: row.models.map(shortModel),
    state: live ? live.state : 'gone',
    stateReason: live?.stateReason ?? null,
    origin: live?.origin ? [live.origin, live.mode].filter(Boolean).join(' · ') : null,
    tokens,
    cacheShare: tokens.total ? tokens.cacheRead / tokens.total : 0,
    toolCalls: row.tools.reduce((a, t) => a + t.count, 0),
    durationMin: Number.isNaN(first) || Number.isNaN(last) ? null : Math.round((last - first) / 60000),
  };
}

export interface ActivityTotals {
  tokens: Tokens;
  toolCalls: number;
  files: number;
  userTurns: number;
  agentTurns: number;
  tools: Array<{ name: string; count: number }>;
}

export function totalsOf(sessions: readonly ActivitySession[]): ActivityTotals {
  const tokens: Tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
  const tools = new Map<string, number>();
  let toolCalls = 0; let files = 0; let userTurns = 0; let agentTurns = 0;
  for (const s of sessions) {
    for (const p of TOKEN_PARTS) tokens[p.k] += s.tokens[p.k];
    tokens.total += s.tokens.total;
    toolCalls += s.toolCalls;
    files += s.row.filesTouched.length;
    userTurns += s.row.userMessages;
    agentTurns += s.row.assistantMessages;
    for (const t of s.row.tools) tools.set(t.name, (tools.get(t.name) ?? 0) + t.count);
  }
  const toolList = [...tools].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tokens, toolCalls, files, userTurns, agentTurns, tools: toolList };
}

/** A touched file split into the name that tells files apart and the folder it lives in. */
export function splitPath(path: string): { base: string; dir: string } {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const base = parts.pop() ?? path;
  return { base, dir: parts.join('/') };
}

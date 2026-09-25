/**
 * Gate K prototype, A/1 "Ledger": the display model Fleet Activity's ledger port
 * renders, derived from the real transcripts plus the live registry. Nothing is
 * invented: the state, title and reason come from the registry session bound by
 * `claudeSessionId`; a transcript with no registry row is "gone" (muted, no mark).
 */
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import type { LedgerTone } from '@/features/shared/components/kit-proto/ledger';
import { FLEET_STATE_META, type FleetTranslations } from '../../../fleetStateMeta';
import { projectLabel } from '../../activityTarget';

export type LedgerState = FleetSessionState | 'gone';

/** Status tone per state, on the app's status roles only (the variant's map; spawning joins queued). */
const STATE_TONE: Record<LedgerState, LedgerTone | null> = {
  awaiting_input: 'warning', running: 'primary', queued: 'info', spawning: 'info', idle: 'neutral',
  stale: 'warning', finished: 'success', hibernated: 'neutral', exited: 'neutral', gone: null,
};

export interface LedgerSession {
  key: string;
  row: FleetTranscriptSummary;
  live: FleetSession | null;
  state: LedgerState;
  tone: LedgerTone | null;
  hollow: boolean;
  title: string | null;
  project: string;
  model: string | null;
  models: string[];
  tokens: { input: number; output: number; cacheCreation: number; cacheRead: number; total: number };
  cacheShare: number;
  context: number;
  toolCalls: number;
  files: number;
  prompts: number;
  replies: number;
  turns: number;
  firstMs: number;
  lastMs: number;
  durationMin: number;
  reason: string | null;
}

/** Model ids arrive vendor-prefixed; the family-version tail is what a row needs. */
export function shortModel(m: string): string {
  return m.replace(/^[^-]+-(?=[a-z])/, '');
}

function toMs(iso: string | null): number {
  const v = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(v) ? 0 : v;
}

export function toLedgerSession(row: FleetTranscriptSummary, byId: ReadonlyMap<string, FleetSession>): LedgerSession {
  const live = byId.get(row.claudeSessionId) ?? null;
  const state: LedgerState = live ? live.state : 'gone';
  const t = { input: Number(row.tokens.input), output: Number(row.tokens.output), cacheCreation: Number(row.tokens.cacheCreation), cacheRead: Number(row.tokens.cacheRead) };
  const total = t.input + t.output + t.cacheCreation + t.cacheRead;
  const firstMs = toMs(row.firstTimestamp);
  const lastMs = toMs(row.lastTimestamp);
  const origin = live?.origin ? `${live.origin.replace(/_/g, ' ')}${live.mode ? ` · ${live.mode}` : ''}` : null;
  return {
    key: row.path,
    row,
    live,
    state,
    tone: STATE_TONE[state],
    hollow: state === 'hibernated',
    title: live?.title ?? null,
    project: projectLabel(row.cwd),
    model: row.models[0] ? shortModel(row.models[0]) : null,
    models: row.models.map(shortModel),
    tokens: { ...t, total },
    cacheShare: total ? t.cacheRead / total : 0,
    context: Number(row.lastContextTokens),
    toolCalls: row.tools.reduce((a, x) => a + x.count, 0),
    files: row.filesTouched.length,
    prompts: row.userMessages,
    replies: row.assistantMessages,
    turns: row.userMessages + row.assistantMessages,
    firstMs,
    lastMs,
    durationMin: firstMs && lastMs ? Math.round((lastMs - firstMs) / 60000) : 0,
    reason: live?.stateReason ? live.stateReason.replace(/^Notification:\s*/, '') : origin,
  };
}

export type SortKey = 'tokens' | 'tools' | 'files' | 'turns' | 'lastMs';

const SORTERS: Record<SortKey, (s: LedgerSession) => number> = {
  tokens: (s) => s.tokens.total, tools: (s) => s.toolCalls, files: (s) => s.files,
  turns: (s) => s.turns, lastMs: (s) => s.lastMs,
};

export function sortSessions(list: LedgerSession[], key: SortKey, dir: 1 | -1): LedgerSession[] {
  const f = SORTERS[key];
  return list.slice().sort((a, b) => (f(a) - f(b)) * dir);
}

/** Column maxima the figures' ink is measured against (never 0, so a share is always defined). */
export function columnMax(list: LedgerSession[]): Record<Exclude<SortKey, 'lastMs'>, number> {
  const m = (f: (s: LedgerSession) => number) => list.reduce((a, s) => Math.max(a, f(s)), 0) || 1;
  return { tokens: m(SORTERS.tokens), tools: m(SORTERS.tools), files: m(SORTERS.files), turns: m(SORTERS.turns) };
}

/** States in the app's attention-first order, `gone` last. */
export const STATE_ORDER: LedgerState[] = [...FLEET_STATE_META.map((m) => m.id), 'gone'];

export function stateTone(state: LedgerState): LedgerTone | null {
  return STATE_TONE[state];
}

/** Tool name x total count across every transcript, most-called first. */
export function toolTotals(list: LedgerSession[]): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const s of list) for (const t of s.row.tools) map.set(t.name, (map.get(t.name) ?? 0) + t.count);
  return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** The state's short label: the app's own per-state key; `gone` has the port's one. */
export function stateLabel(f: FleetTranslations, state: LedgerState): string {
  if (state === 'gone') return f.activity_state_gone;
  const meta = FLEET_STATE_META.find((m) => m.id === state);
  return meta ? String(f[meta.labelKey]) : state;
}

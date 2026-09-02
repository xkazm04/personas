// monitorModel — pure logic for the Persona Monitor.
//
// Two orthogonal signal layers per persona card:
//   • Execution state → card COLOUR. running (pulsing) > failed (red) >
//     attention (default tone) > idle (muted).
//   • Required attention → BADGES. Human reviews and unread messages each
//     get their own icon+count badge; clicking one opens that drawer section.
//
// A persona can be running AND have pending reviews — colour and badges are
// independent.

import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ActiveProcess, ActiveProcessStatus } from '@/stores/slices/processActivitySlice';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { HealthStatus } from '@/lib/bindings/HealthStatus';
import type { Translations } from '@/i18n/generated/types';

export type SeverityBucket = 'critical' | 'warning' | 'info';

/** Execution lifecycle state — drives the persona card colour. */
export type ExecState = 'running' | 'failed' | 'attention' | 'idle';

/** Which drawer section a badge / affordance opens. */
export type DrawerSection = 'reviews' | 'messages' | 'activity' | 'capabilities';

/**
 * Fine-grained card state (v2) — the priority-resolved "what is this persona
 * doing right now" key, finer than {@link ExecState} (which folds
 * input_required / draft_ready / queued / reviews all under `attention`).
 * Drives the pillar top-strip colour and the state caption.
 *
 * Priority (highest first): running > failed > input_required > draft_ready >
 * queued > attention > idle.
 */
export type PillarStateKey =
  | 'running'
  | 'failed'
  | 'input_required'
  | 'draft_ready'
  | 'queued'
  | 'attention'
  | 'idle';

/** Every severity token any producer in this tree actually emits. */
const READABLE_SEVERITY: Record<string, SeverityBucket> = {
  critical: 'critical',
  error: 'critical',
  high: 'warning',
  warning: 'warning',
  low: 'info',
  info: 'info',
};

/**
 * Collapse a raw review severity string into one of three buckets. A token
 * that is not in the readable set is NOT quietly `info`: it takes the loudest
 * bucket, so an item nobody could classify sorts to the top of the queue
 * rather than to the arm that gets the least scrutiny.
 */
export function severityBucket(sev: string): SeverityBucket {
  return READABLE_SEVERITY[(sev ?? '').trim().toLowerCase()] ?? 'critical';
}

interface SeverityMeta {
  /** Lower = higher priority. */
  rank: number;
  chip: string;
  badge: string;
  dot: string;
  text: string;
  icon: ComponentType<{ className?: string }>;
}

export const SEVERITY_META: Record<SeverityBucket, SeverityMeta> = {
  critical: {
    rank: 0, icon: AlertCircle,
    chip: 'bg-red-500/10 text-red-400 border-red-500/30',
    badge: 'bg-red-500/15 text-red-300 border-red-500/30',
    dot: 'bg-red-400', text: 'text-red-400',
  },
  warning: {
    rank: 1, icon: AlertTriangle,
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400', text: 'text-amber-400',
  },
  info: {
    rank: 2, icon: Info,
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    dot: 'bg-blue-400', text: 'text-blue-400',
  },
};

/** Translated label for a review severity bucket. */
export function severityLabel(t: Translations, b: SeverityBucket): string {
  switch (b) {
    case 'critical': return t.monitor.attention_critical;
    case 'warning': return t.monitor.attention_warning;
    case 'info': return t.monitor.attention_info;
  }
}

export interface ProcessStatusMeta {
  dot: string;
  text: string;
  /** Whether the status dot should pulse (live work). */
  pulse: boolean;
}

/**
 * Keyed by the CLOSED {@link ActiveProcessStatus} union, so a status added to
 * the store forces an entry here at compile time rather than silently landing
 * on whatever the fallback happens to be.
 */
export const PROCESS_STATUS_META: Record<ActiveProcessStatus, ProcessStatusMeta> = {
  running: { dot: 'bg-primary', text: 'text-primary', pulse: true },
  queued: { dot: 'bg-amber-400', text: 'text-amber-400', pulse: false },
  input_required: { dot: 'bg-orange-400', text: 'text-orange-400', pulse: true },
  draft_ready: { dot: 'bg-violet-400', text: 'text-violet-400', pulse: false },
  completed: { dot: 'bg-green-400', text: 'text-green-400', pulse: false },
  failed: { dot: 'bg-red-400', text: 'text-red-400', pulse: false },
  cancelled: { dot: 'bg-foreground/40', text: 'text-foreground', pulse: false },
};

/**
 * What an UNRECOGNISED status looks like: neutral, and above all NOT pulsing.
 * A layer that did not observe the state must not substitute a busy one — a
 * status this build has never heard of will never receive the transition that
 * clears it, so rendering it as live work leaves a permanent phantom "running"
 * process on the card. Deliberately the `cancelled` tone: legible, inert.
 */
export const UNKNOWN_PROCESS_STATUS_META: ProcessStatusMeta = {
  dot: 'bg-foreground/40', text: 'text-foreground', pulse: false,
};

/**
 * Resolve a raw status token to its visual meta. Takes `string` (not the
 * union) on purpose: the token can arrive from persisted state or a newer
 * backend, and the point of this function is to survive that. An unknown token
 * gets {@link UNKNOWN_PROCESS_STATUS_META} — never `running`. Paired with
 * {@link processStatusLabel}, which passes an unknown token through verbatim:
 * both say "we do not know what this is" rather than guessing.
 */
export function processStatusMeta(status: string): ProcessStatusMeta {
  // `hasOwn`, not a bare index: `PROCESS_STATUS_META['constructor']` walks the
  // prototype chain and hands back a truthy non-meta, which `??` would accept.
  return Object.hasOwn(PROCESS_STATUS_META, status)
    ? (PROCESS_STATUS_META as Record<string, ProcessStatusMeta>)[status]!
    : UNKNOWN_PROCESS_STATUS_META;
}

/** Translated label for a process status; an unknown token passes through raw. */
export function processStatusLabel(t: Translations, status: string): string {
  switch (status) {
    case 'running': return t.monitor.status_running;
    case 'queued': return t.monitor.status_queued;
    case 'input_required': return t.monitor.status_input_required;
    case 'draft_ready': return t.monitor.status_draft_ready;
    case 'completed': return t.monitor.status_completed;
    case 'failed': return t.monitor.status_failed;
    case 'cancelled': return t.monitor.status_cancelled;
    default: return status;
  }
}

/** An `activeProcesses` entry with its store key kept alongside the value. */
export interface ProcessEntry {
  key: string;
  proc: ActiveProcess;
}

export interface PersonaCardModel {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  reviews: ManualReviewItem[];
  reviewCounts: Record<SeverityBucket, number>;
  /** Highest-severity review bucket present — tints the review badge. */
  topReviewSeverity: SeverityBucket | null;
  /** Unread messages for this persona. */
  messages: PersonaReport[];
  processes: ProcessEntry[];
  running: number;
  queued: number;
  inputRequired: number;
  draftReady: number;
  /** Earliest `startedAt` among running processes, for the live elapsed timer. */
  runningSince: number | null;
  /** Execution lifecycle state — drives the card colour. */
  execState: ExecState;
  /** Reviews + unread messages — total badge-able attention. */
  attentionCount: number;

  // --- v2 enrichment -------------------------------------------------------
  /** Canonical health level from recent outcomes; `null` when no health data. */
  healthStatus: HealthStatus | null;
  /** Last N execution outcome tokens, newest-first (e.g. `["completed","failed"]`). */
  recentStatuses: string[];
  /** Success rate 0–1 over recent runs, or `null` when there are none. */
  successRate: number | null;
  /** Executions started today. */
  runsToday: number;
  /** Total recent executions examined for health. */
  totalRecent: number;
  /** Live USD cost summed across this persona's running processes. */
  liveCostUsd: number;
  /** Live tool-call count summed across this persona's running processes. */
  liveToolCalls: number;
}

export interface MonitorModel {
  cards: PersonaCardModel[];
  /** Active processes that could not be attributed to any persona. */
  systemProcesses: ProcessEntry[];
}

/**
 * Build the full Monitor model: one card per persona (fleet-wide, including
 * idle personas) plus leftover app-level processes.
 *
 * `unreadMessages` should already be filtered to unread. `healthMap` is the
 * agent store's per-persona `PersonaHealth` — `recentStatuses[0]` is the most
 * recent execution outcome and drives the `failed` colour.
 */
export function buildMonitorModel(
  personas: Persona[],
  reviews: ManualReviewItem[],
  unreadMessages: PersonaReport[],
  activeProcesses: Record<string, ActiveProcess>,
  healthMap: Record<string, PersonaHealth>,
): MonitorModel {
  const reviewsByPersona = groupBy(reviews, (r) => r.persona_id || 'unassigned');
  const messagesByPersona = groupBy(unreadMessages, (m) => m.persona_id || 'unassigned');

  // --- process attribution -------------------------------------------------
  const personaIds = new Set(personas.map((p) => p.id));
  // A display label is not a namespaced key: two personas can share a name, and
  // a system/app process's free-form label can coincidentally equal a persona's
  // name. Track collisions so the fallback below only fires when the name
  // unambiguously identifies exactly one persona.
  const nameToId = new Map<string, string>();
  const nameCollisions = new Set<string>();
  for (const p of personas) {
    if (nameToId.has(p.name)) nameCollisions.add(p.name);
    else nameToId.set(p.name, p.id);
  }

  const processesByPersona = new Map<string, ProcessEntry[]>();
  const systemProcesses: ProcessEntry[] = [];
  for (const [key, proc] of Object.entries(activeProcesses)) {
    const entry: ProcessEntry = { key, proc };
    let owner: string | null = null;
    if (proc.personaId && personaIds.has(proc.personaId)) {
      owner = proc.personaId;
    } else if (proc.navigateTo?.personaId && personaIds.has(proc.navigateTo.personaId)) {
      owner = proc.navigateTo.personaId;
    } else if (proc.label && nameToId.has(proc.label) && !nameCollisions.has(proc.label)) {
      owner = nameToId.get(proc.label)!;
    }
    if (owner) push(processesByPersona, owner, entry);
    else systemProcesses.push(entry);
  }

  const makeCard = (
    id: string,
    name: string,
    icon: string | null,
    color: string | null,
    revs: ManualReviewItem[],
    msgs: PersonaReport[],
    procs: ProcessEntry[],
    health: PersonaHealth | undefined,
  ): PersonaCardModel => {
    const reviewCounts: Record<SeverityBucket, number> = { critical: 0, warning: 0, info: 0 };
    for (const r of revs) reviewCounts[severityBucket(r.severity)] += 1;
    const topReviewSeverity: SeverityBucket | null =
      reviewCounts.critical > 0 ? 'critical'
        : reviewCounts.warning > 0 ? 'warning'
          : reviewCounts.info > 0 ? 'info'
            : null;

    let running = 0, queued = 0, inputRequired = 0, draftReady = 0;
    let runningSince: number | null = null;
    let liveCostUsd = 0, liveToolCalls = 0;
    for (const { proc } of procs) {
      switch (proc.status) {
        case 'running':
          running += 1;
          if (runningSince === null || proc.startedAt < runningSince) runningSince = proc.startedAt;
          liveCostUsd += proc.costUsd;
          liveToolCalls += proc.toolCallCount;
          break;
        case 'queued': queued += 1; break;
        case 'input_required': inputRequired += 1; break;
        case 'draft_ready': draftReady += 1; break;
        default: break;
      }
    }

    const attentionCount = revs.length + msgs.length;
    const hasAttention = attentionCount > 0 || queued > 0 || inputRequired > 0 || draftReady > 0;
    const recentStatuses = health?.recentStatuses ?? [];
    const lastFailed = recentStatuses[0] === 'failed';
    const execState: ExecState =
      running > 0 ? 'running'
        : lastFailed ? 'failed'
          : hasAttention ? 'attention'
            : 'idle';

    return {
      personaId: id, personaName: name, personaIcon: icon, personaColor: color,
      reviews: revs, reviewCounts, topReviewSeverity,
      messages: msgs, processes: procs,
      running, queued, inputRequired, draftReady, runningSince,
      execState, attentionCount,
      healthStatus: health?.status ?? null,
      recentStatuses,
      successRate: health ? health.successRate : null,
      runsToday: health ? Number(health.runsToday) : 0,
      totalRecent: health ? Number(health.totalRecent) : 0,
      liveCostUsd, liveToolCalls,
    };
  };

  const cards: PersonaCardModel[] = [];
  for (const p of personas) {
    cards.push(makeCard(
      p.id, p.name, p.icon, p.color,
      reviewsByPersona.get(p.id) ?? [],
      messagesByPersona.get(p.id) ?? [],
      processesByPersona.get(p.id) ?? [],
      healthMap[p.id],
    ));
  }
  // Orphan reviews/messages — persona deleted or unassigned.
  const orphanKeys = new Set<string>();
  for (const k of reviewsByPersona.keys()) if (!personaIds.has(k)) orphanKeys.add(k);
  for (const k of messagesByPersona.keys()) if (!personaIds.has(k)) orphanKeys.add(k);
  for (const key of orphanKeys) {
    const revs = reviewsByPersona.get(key) ?? [];
    const msgs = messagesByPersona.get(key) ?? [];
    const sample = revs[0];
    const name = key === 'unassigned' ? 'Unassigned' : (sample?.persona_name || 'Unknown persona');
    cards.push(makeCard(
      key, name, sample?.persona_icon ?? null, sample?.persona_color ?? null,
      revs, msgs, [], undefined,
    ));
  }

  // Sort: failures → things needing the user → just-busy → idle.
  const sortRank = (c: PersonaCardModel): number => {
    if (c.execState === 'failed') return 0;
    if (c.attentionCount > 0 || c.inputRequired > 0 || c.draftReady > 0) return 1;
    if (c.running > 0 || c.queued > 0) return 2;
    return 3;
  };
  cards.sort((a, b) => {
    const ra = sortRank(a);
    const rb = sortRank(b);
    if (ra !== rb) return ra - rb;
    if (a.attentionCount !== b.attentionCount) return b.attentionCount - a.attentionCount;
    if (a.running !== b.running) return b.running - a.running;
    return a.personaName.localeCompare(b.personaName);
  });

  return { cards, systemProcesses };
}

/** Human-readable elapsed string for a `startedAt` timestamp. */
export function elapsedStr(startedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ===========================================================================
// v2 — pure presentational resolvers
//
// These take a fully-built PersonaCardModel and return *data* describing how
// to render it. They contain no JSX and no i18n, so they are trivially
// unit-testable (see monitorModel.test.ts) and the component layer owns the
// actual markup + translated strings.
// ===========================================================================

/**
 * Priority-resolve a card to its fine-grained pillar state key.
 * running > failed > input_required > draft_ready > queued > attention > idle.
 */
export function pillarStateKey(card: PersonaCardModel): PillarStateKey {
  if (card.running > 0) return 'running';
  if (card.execState === 'failed') return 'failed';
  if (card.inputRequired > 0) return 'input_required';
  if (card.draftReady > 0) return 'draft_ready';
  if (card.queued > 0) return 'queued';
  if (card.attentionCount > 0) return 'attention';
  return 'idle';
}

/**
 * The single most relevant drawer section for a card — drives the always-present
 * title click target. Unlike {@link captionDescriptor}'s `target` (which is
 * `null` for passive states), this always resolves to a concrete section.
 */
export function primaryDrawerSection(card: PersonaCardModel): DrawerSection {
  const key = pillarStateKey(card);
  if (key === 'attention') return card.reviews.length > 0 ? 'reviews' : 'messages';
  if (key === 'idle') return 'capabilities';
  return 'activity';
}

/** Tone of a single recent-run outcome token, for the health micro-bar. */
export type HealthTone = 'success' | 'fail' | 'other' | 'none';

export function healthTone(status: string | undefined): HealthTone {
  if (!status) return 'none';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'fail';
  if (status === 'cancelled') return 'other';
  return 'other';
}

export const HEALTH_TONE_CLASS: Record<HealthTone, string> = {
  success: 'bg-emerald-400/80',
  fail: 'bg-red-400/80',
  other: 'bg-amber-400/70',
  none: 'bg-foreground/15',
};

/**
 * Build the health micro-bar segments for a card: a fixed-length array
 * (oldest→newest, left→right for natural reading) padded with `none` so every
 * card's bar is the same width. `recentStatuses` arrives newest-first, so we
 * take the first `length`, reverse to oldest-first, then left-pad.
 */
export function healthSegments(card: PersonaCardModel, length: number): HealthTone[] {
  const recent = card.recentStatuses.slice(0, length).map(healthTone).reverse();
  const pad = length - recent.length;
  return pad > 0 ? [...Array<HealthTone>(pad).fill('none'), ...recent] : recent;
}

// --- small helpers ----------------------------------------------------------

function groupBy<T>(items: T[], keyOf: (x: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) push(map, keyOf(item), item);
  return map;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

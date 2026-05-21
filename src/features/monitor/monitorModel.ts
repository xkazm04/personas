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
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { Translations } from '@/i18n/generated/types';

export type SeverityBucket = 'critical' | 'warning' | 'info';

/** Execution lifecycle state — drives the persona card colour. */
export type ExecState = 'running' | 'failed' | 'attention' | 'idle';

/** Which drawer section a badge / affordance opens. */
export type DrawerSection = 'reviews' | 'messages' | 'activity';

/** Collapse a raw review severity string into one of three buckets. */
export function severityBucket(sev: string): SeverityBucket {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning' || sev === 'high') return 'warning';
  return 'info';
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

export interface ExecStateMeta {
  /** Persona card background + border. */
  card: string;
  /** True when the card should carry the pulsing live-work ring. */
  pulse: boolean;
}

export const EXEC_STATE_META: Record<ExecState, ExecStateMeta> = {
  // Bright, pulsing — the persona is doing live work right now.
  running: { card: 'bg-primary/[0.08] border-primary/45', pulse: true },
  // Red — the most recent execution failed.
  failed: { card: 'bg-red-500/[0.09] border-red-500/35 hover:bg-red-500/[0.14]', pulse: false },
  // Default app tone — idle, but something needs the user.
  attention: { card: 'bg-secondary/40 border-primary/15 hover:bg-secondary/55', pulse: false },
  // Muted — nothing happening, nothing pending.
  idle: { card: 'bg-secondary/15 border-primary/8', pulse: false },
};

export interface ProcessStatusMeta {
  dot: string;
  text: string;
  /** Whether the status dot should pulse (live work). */
  pulse: boolean;
}

export const PROCESS_STATUS_META: Record<string, ProcessStatusMeta> = {
  running: { dot: 'bg-primary', text: 'text-primary', pulse: true },
  queued: { dot: 'bg-amber-400', text: 'text-amber-400', pulse: false },
  input_required: { dot: 'bg-orange-400', text: 'text-orange-400', pulse: true },
  draft_ready: { dot: 'bg-violet-400', text: 'text-violet-400', pulse: false },
  completed: { dot: 'bg-green-400', text: 'text-green-400', pulse: false },
  failed: { dot: 'bg-red-400', text: 'text-red-400', pulse: false },
  cancelled: { dot: 'bg-foreground/40', text: 'text-foreground', pulse: false },
};

export function processStatusMeta(status: string): ProcessStatusMeta {
  return PROCESS_STATUS_META[status] ?? PROCESS_STATUS_META.running!;
}

/** Translated label for a process status. */
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
  messages: PersonaMessage[];
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
  unreadMessages: PersonaMessage[],
  activeProcesses: Record<string, ActiveProcess>,
  healthMap: Record<string, PersonaHealth>,
): MonitorModel {
  const reviewsByPersona = groupBy(reviews, (r) => r.persona_id || 'unassigned');
  const messagesByPersona = groupBy(unreadMessages, (m) => m.persona_id || 'unassigned');

  // --- process attribution -------------------------------------------------
  const personaIds = new Set(personas.map((p) => p.id));
  const nameToId = new Map<string, string>();
  for (const p of personas) nameToId.set(p.name, p.id);

  const processesByPersona = new Map<string, ProcessEntry[]>();
  const systemProcesses: ProcessEntry[] = [];
  for (const [key, proc] of Object.entries(activeProcesses)) {
    const entry: ProcessEntry = { key, proc };
    let owner: string | null = null;
    if (proc.personaId && personaIds.has(proc.personaId)) {
      owner = proc.personaId;
    } else if (proc.navigateTo?.personaId && personaIds.has(proc.navigateTo.personaId)) {
      owner = proc.navigateTo.personaId;
    } else if (proc.label && nameToId.has(proc.label)) {
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
    msgs: PersonaMessage[],
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
    for (const { proc } of procs) {
      switch (proc.status) {
        case 'running':
          running += 1;
          if (runningSince === null || proc.startedAt < runningSince) runningSince = proc.startedAt;
          break;
        case 'queued': queued += 1; break;
        case 'input_required': inputRequired += 1; break;
        case 'draft_ready': draftReady += 1; break;
        default: break;
      }
    }

    const attentionCount = revs.length + msgs.length;
    const hasAttention = attentionCount > 0 || queued > 0 || inputRequired > 0 || draftReady > 0;
    const lastFailed = health?.recentStatuses[0] === 'failed';
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

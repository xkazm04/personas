// monitorModel — pure logic for the Persona Monitor.
//
// The Monitor fuses two orthogonal signals onto one persona card:
//   • Attention — does the persona need a human? → drives the card COLOUR.
//   • Activity  — is the persona working right now? → drives the live PULSE.
//
// Attention priority (highest wins): critical review > input-required process
// > warning review > draft-ready process > info review. A persona can be both
// "attention" and "active" at once — the colour and the pulse are independent.

import { AlertCircle, AlertTriangle, Info, MessageCircleQuestion, FileText } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import type { Persona } from '@/lib/bindings/Persona';
import type { Translations } from '@/i18n/generated/types';

export type SeverityBucket = 'critical' | 'warning' | 'info';

/** What can make a persona card demand a human, in priority order. */
export type AttentionBucket = 'critical' | 'input_required' | 'warning' | 'draft_ready' | 'info';

/** Collapse a raw review severity string into one of three buckets. */
export function reviewBucket(sev: string): SeverityBucket {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning' || sev === 'high') return 'warning';
  return 'info';
}

interface AttentionMeta {
  /** Lower = higher priority. */
  rank: number;
  /** Persona card background + border. */
  card: string;
  /** Bordered chip (header / drawer). */
  chip: string;
  /** Count badge. */
  badge: string;
  /** Solid dot. */
  dot: string;
  /** Accent text. */
  text: string;
  icon: ComponentType<{ className?: string }>;
}

export const ATTENTION_META: Record<AttentionBucket, AttentionMeta> = {
  critical: {
    rank: 0, icon: AlertCircle,
    card: 'bg-red-500/10 border-red-500/30 hover:bg-red-500/16',
    chip: 'bg-red-500/10 text-red-400 border-red-500/30',
    badge: 'bg-red-500/20 text-red-300', dot: 'bg-red-400', text: 'text-red-400',
  },
  input_required: {
    rank: 1, icon: MessageCircleQuestion,
    card: 'bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/16',
    chip: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    badge: 'bg-orange-500/20 text-orange-300', dot: 'bg-orange-400', text: 'text-orange-400',
  },
  warning: {
    rank: 2, icon: AlertTriangle,
    card: 'bg-amber-500/10 border-amber-500/25 hover:bg-amber-500/16',
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    badge: 'bg-amber-500/20 text-amber-300', dot: 'bg-amber-400', text: 'text-amber-400',
  },
  draft_ready: {
    rank: 3, icon: FileText,
    card: 'bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/16',
    chip: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    badge: 'bg-violet-500/20 text-violet-300', dot: 'bg-violet-400', text: 'text-violet-400',
  },
  info: {
    rank: 4, icon: Info,
    card: 'bg-blue-500/10 border-blue-500/22 hover:bg-blue-500/16',
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    badge: 'bg-blue-500/20 text-blue-300', dot: 'bg-blue-400', text: 'text-blue-400',
  },
};

/** Translated label for an attention bucket. */
export function attentionLabel(t: Translations, b: AttentionBucket): string {
  switch (b) {
    case 'critical': return t.monitor.attention_critical;
    case 'input_required': return t.monitor.attention_input_required;
    case 'warning': return t.monitor.attention_warning;
    case 'draft_ready': return t.monitor.attention_draft_ready;
    case 'info': return t.monitor.attention_info;
  }
}

/** A clear (no attention) but live persona card, and the "busy" sort tier. */
export const MUTED_CARD = 'bg-secondary/15 border-primary/8';
export const BUSY_CARD = 'bg-primary/[0.06] border-primary/20 hover:bg-primary/10';

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
  processes: ProcessEntry[];
  /** Highest-priority attention bucket present, or null when the card is clear. */
  attention: AttentionBucket | null;
  running: number;
  queued: number;
  inputRequired: number;
  draftReady: number;
  /** Items demanding a human: reviews + input-required + draft-ready processes. */
  attentionCount: number;
  /** Earliest `startedAt` among running processes, for the live elapsed timer. */
  runningSince: number | null;
}

export interface MonitorModel {
  cards: PersonaCardModel[];
  /** Active processes that could not be attributed to any persona. */
  systemProcesses: ProcessEntry[];
}

/**
 * Build the full Monitor model: one card per persona (fleet-wide, including
 * idle personas) plus the leftover app-level / unattributable processes.
 *
 * Process → persona attribution is best-effort: `personaId`, then
 * `navigateTo.personaId`, then an exact `label === persona.name` match.
 * `PROCESS_ACTIVITY` "started" events carry no persona id, so a running
 * execution only lands on a card when its label matches a persona name —
 * everything else falls through to `systemProcesses`.
 */
export function buildMonitorModel(
  personas: Persona[],
  reviews: ManualReviewItem[],
  activeProcesses: Record<string, ActiveProcess>,
): MonitorModel {
  // --- reviews grouped by persona ------------------------------------------
  const reviewsByPersona = new Map<string, ManualReviewItem[]>();
  for (const r of reviews) {
    const key = r.persona_id || 'unassigned';
    const list = reviewsByPersona.get(key);
    if (list) list.push(r);
    else reviewsByPersona.set(key, [r]);
  }

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
    if (owner) {
      const list = processesByPersona.get(owner);
      if (list) list.push(entry);
      else processesByPersona.set(owner, [entry]);
    } else {
      systemProcesses.push(entry);
    }
  }

  const makeCard = (
    id: string,
    name: string,
    icon: string | null,
    color: string | null,
    revs: ManualReviewItem[],
    procs: ProcessEntry[],
  ): PersonaCardModel => {
    const reviewCounts: Record<SeverityBucket, number> = { critical: 0, warning: 0, info: 0 };
    for (const r of revs) reviewCounts[reviewBucket(r.severity)] += 1;

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

    const attention: AttentionBucket | null =
      reviewCounts.critical > 0 ? 'critical'
        : inputRequired > 0 ? 'input_required'
          : reviewCounts.warning > 0 ? 'warning'
            : draftReady > 0 ? 'draft_ready'
              : reviewCounts.info > 0 ? 'info'
                : null;

    return {
      personaId: id, personaName: name, personaIcon: icon, personaColor: color,
      reviews: revs, reviewCounts, processes: procs,
      attention, running, queued, inputRequired, draftReady,
      attentionCount: revs.length + inputRequired + draftReady,
      runningSince,
    };
  };

  const cards: PersonaCardModel[] = [];
  for (const p of personas) {
    cards.push(makeCard(
      p.id, p.name, p.icon, p.color,
      reviewsByPersona.get(p.id) ?? [],
      processesByPersona.get(p.id) ?? [],
    ));
  }
  // Orphan reviews — persona deleted or unassigned. Render so nothing is lost.
  for (const [key, revs] of reviewsByPersona) {
    if (key !== 'unassigned' && personaIds.has(key)) continue;
    if (key === 'unassigned') {
      cards.push(makeCard('unassigned', 'Unassigned', null, null, revs, []));
    } else {
      const first = revs[0]!;
      cards.push(makeCard(
        key, first.persona_name || 'Unknown persona',
        first.persona_icon ?? null, first.persona_color ?? null, revs, [],
      ));
    }
  }

  // Sort: attention tier (by rank) → busy-but-clear → idle. Within a tier,
  // most attention-bearing first, then most active, then alphabetical.
  const sortRank = (c: PersonaCardModel): number => {
    if (c.attention) return ATTENTION_META[c.attention].rank;   // 0..4
    if (c.running > 0 || c.queued > 0) return 5;                 // busy, clear
    return 6;                                                    // idle
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
